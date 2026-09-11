// Deliberately does not load .env: operators must explicitly supply the runtime environment.
import { readFile, stat } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { bootstrapProduction, type InitialAdmin } from "../src/db/production-bootstrap";
import { closeDatabases } from "../src/db";

function required(key: string): string {
  const value = process.env[key];
  if (!value?.trim()) throw new Error(`CONFIG_REQUIRED: ${key}`);
  return value;
}

async function readAdmins(path: string | undefined): Promise<InitialAdmin[]> {
  if (!path) throw new Error("CONFIG_REQUIRED: --credentials file");
  const info = await stat(path);
  if (!info.isFile() || info.size > 16_384 || (process.platform !== "win32" && (info.mode & 0o077) !== 0)) {
    throw new Error("CREDENTIAL_FILE: use a regular owner-only file (0400/0600)");
  }
  const input: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(input) || input.length !== 2) throw new Error("ADMIN_CONFIG: exactly two independent administrators required");
  const admins = input.map((value): InitialAdmin => {
    if (!value || typeof value !== "object" || typeof value.name !== "string" || !value.name.trim() || typeof value.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim()) || typeof value.password !== "string" || value.password.length < 8 || value.password.length > 128) {
      throw new Error("ADMIN_CONFIG: name, valid email, and 8–128 character password required");
    }
    return { name: value.name.trim(), email: value.email.trim().toLowerCase(), password: value.password };
  });
  if (admins[0].email === admins[1].email) throw new Error("ADMIN_CONFIG: administrator emails must differ");
  return admins;
}

async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { target: { type: "string" }, credentials: { type: "string" }, search: { type: "string" }, environment: { type: "string" }, "user-id": { type: "string" }, name: { type: "string" }, email: { type: "string" } } });
  const command = positionals[0];
  if (positionals.length !== 1 || !["verify", "migrate", "bootstrap", "reindex", "search-status", "recover-admin", "promote-first-superadmin"].includes(command)) {
    throw new Error("USAGE: ops:production verify|migrate|bootstrap|reindex|search-status|recover-admin|promote-first-superadmin --target host:port/database/user [--credentials file] [--search http://host:port/index]; recover-admin additionally requires --environment, --user-id and --email; promote-first-superadmin requires --environment, --user-id and --name");
  }
  const url = new URL(required("DATABASE_URL"));
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.search || url.hash || !url.hostname || !url.username || !url.password || url.pathname.length < 2) {
    throw new Error("DATABASE_CONFIG: explicit PostgreSQL host/database/user/password required; URL options forbidden");
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  const username = decodeURIComponent(url.username);
  const target = `${url.hostname}:${url.port || "5432"}/${database}/${username}`;
  if (values.target !== target) throw new Error("TARGET_MISMATCH: --target must match host:port/database/user; no changes made");
  let admins: InitialAdmin[] = [];
  let recoveryPassword: unknown;
  if (command === "promote-first-superadmin" && (!values.environment || values.environment !== required("PHOSKYWIKI_ENV") || !values["user-id"] || !values.name)) {
    throw new Error("SUPERADMIN_CONFIG: matching --environment, --user-id and --name required");
  }
  if (command === "recover-admin") {
    if (!values.environment || values.environment !== required("PHOSKYWIKI_ENV") || !values["user-id"] || !values.email || !values.credentials) throw new Error("RECOVERY_CONFIG: explicit matching environment, --user-id, --email and --credentials required");
    const info = await stat(values.credentials);
    if (!info.isFile() || info.size > 4096 || (process.platform !== "win32" && (info.mode & 0o077) !== 0)) throw new Error("CREDENTIAL_FILE: owner-only recovery JSON required");
    const config = JSON.parse(await readFile(values.credentials, "utf8"));
    recoveryPassword = config?.password;
  }
  if (command === "bootstrap") {
    if (required("BETTER_AUTH_SECRET").length < 32) throw new Error("AUTH_CONFIG: signing secret needs at least 32 characters");
    const origin = new URL(required("BETTER_AUTH_URL"));
    if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("AUTH_CONFIG: valid site origin required");
    admins = await readAdmins(values.credentials);
  }
  if (command === "reindex" || command === "search-status") {
    const host = new URL(required("MEILI_HOST"));
    const index = required("MEILI_INDEX_UID");
    required("MEILI_MASTER_KEY");
    if (host.username || host.password || host.search || host.hash || host.pathname !== "/" || !["http:", "https:"].includes(host.protocol) || !/^[\w-]+$/.test(index) || values.search !== `${host.origin}/${index}`) {
      throw new Error("SEARCH_TARGET_MISMATCH: --search must match MEILI_HOST/MEILI_INDEX_UID");
    }
  }
  // Explicit connection fields prevent libpq environment/query-string overrides.
  const pool = new Pool({ host: url.hostname, port: Number(url.port || 5432), database, user: username, password: decodeURIComponent(url.password), max: 1, connectionTimeoutMillis: 5000 });
  try {
    const identity = (await pool.query("select current_database() as database, current_user as username")).rows[0];
    if (identity.database !== database || identity.username !== username) throw new Error("TARGET_MISMATCH: connected database identity differs; no changes made");
    const db = drizzle(pool);
    let result: object = {};
    if (command === "migrate") await migrate(db, { migrationsFolder: "drizzle" });
    if (command === "bootstrap") result = await bootstrapProduction(db, admins);
    if (command === "promote-first-superadmin") {
      const { bootstrapSuperAdmin } = await import("../src/db/bootstrap-superadmin");
      result = await bootstrapSuperAdmin(db, values["user-id"]!, values.name!);
    }
    if (command === "recover-admin") {
      const { recoverAdministrator } = await import("../src/lib/access-grants");
      await recoverAdministrator(db, values["user-id"]!, values.email!, recoveryPassword);
      result = { recovered: true, environment: values.environment };
    }
    if (command === "reindex") {
      const { reindexAll } = await import("../src/lib/search/search-sync");
      result = await reindexAll();
    }
    if (command === "search-status") {
      const { searchStatus } = await import("../src/lib/search/search-maintenance");
      const search = await searchStatus();
      console.log(JSON.stringify({ ok: search.available && !search.degraded, search }));
      return;
    }
    console.log(JSON.stringify({ ok: true, command, target, ...result, peakRssBytes: process.resourceUsage().maxRSS * 1024 }));
  } finally {
    await pool.end();
    await closeDatabases();
  }
}

main().catch((error: unknown) => {
  // Database/JSON/library errors may contain credentials or bound parameters.
  // Only our literal diagnostics are safe to emit.
  const message = error instanceof Error ? error.message : "";
  const safe = /^(CONFIG_REQUIRED|CREDENTIAL_FILE|RECOVERY_CONFIG|RECOVERY_TARGET|SUPERADMIN_CONFIG|SUPERADMIN_TARGET|SUPERADMIN_EXISTS|ADMIN_CONFIG|ADMIN_CONFLICT|ADMIN_CREDENTIAL_CONFLICT|DATABASE_CONFIG|TARGET_MISMATCH|AUTH_CONFIG|SEARCH_TARGET_MISMATCH|USAGE):/.test(message);
  console.error(safe ? message : "OPERATION_FAILED: check target, protected configuration, database availability and migrations; no credentials logged");
  process.exitCode = 1;
});
