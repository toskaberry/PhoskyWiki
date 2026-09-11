import { readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";

// A bind-mounted owner-only JSON file keeps secrets out of image layers,
// Compose interpolation, process arguments, and docker inspect's Config.Env.
try {
  const path = process.env.RUNTIME_CONFIG_FILE || "/run/secrets/runtime.json";
  const info = statSync(path);
  if (!info.isFile() || info.size > 32_768 || (info.mode & 0o077) !== 0) throw new Error();
  const config = JSON.parse(readFileSync(path, "utf8"));
  const keys = ["DATABASE_URL", "BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "MEILI_HOST", "MEILI_MASTER_KEY", "MEILI_INDEX_UID", "R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
  for (const key of keys) {
    if (typeof config[key] !== "string" || !config[key].trim()) throw new Error();
    process.env[key] = config[key];
  }
  for (const key of ["INVITATION_TTL_SECONDS", "PASSWORD_RESET_TTL_SECONDS", "PHOSKYWIKI_ENV",
    "WRITE_LIMIT_COUNT", "WRITE_LIMIT_SECONDS", "UPLOAD_LIMIT_COUNT", "UPLOAD_LIMIT_SECONDS",
    "COMPLETE_LIMIT_COUNT", "COMPLETE_LIMIT_SECONDS", "UPLOAD_FILE_BYTES", "UPLOAD_ACCOUNT_BYTES",
    "UPLOAD_PENDING_COUNT", "UPLOAD_STAGING_SECONDS"]) {
    if (config[key] !== undefined) {
      if (typeof config[key] !== "string" || !config[key].trim()) throw new Error();
      process.env[key] = config[key];
    }
  }
  const [command, ...args] = process.argv.slice(2);
  if (!["serve", "verify", "migrate", "bootstrap", "reindex", "search-status", "recover-admin", "promote-first-superadmin", "images"].includes(command)) throw new Error();
  const child = spawn(process.execPath, command === "serve"
    ? ["node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
    : command === "images"
      ? ["--conditions=react-server", "--import=tsx", "scripts/images.ts", ...args]
      : ["--conditions=react-server", "--import=tsx", "scripts/production.ts", command, ...args], { stdio: "inherit" });
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
  child.on("error", () => { console.error("CONTAINER_START_FAILED"); process.exit(1); });
  child.on("exit", code => process.exit(code ?? 1));
} catch {
  console.error("CONTAINER_CONFIG: provide an owner-only runtime JSON file with all documented keys and a supported command");
  process.exit(1);
}
