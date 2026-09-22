import { execFileSync } from "node:child_process";
import { assertIsolatedTestEnvironment } from "./isolated-environment";

export default function setup() {
  assertIsolatedTestEnvironment();
  const host = process.env.E2E_MEILI_HOST;
  if (!host) return;

  const database = new URL(process.env.DATABASE_URL!);
  const target = `${database.hostname}:${database.port || "5432"}/${decodeURIComponent(database.pathname.slice(1))}/${decodeURIComponent(database.username)}`;

  // db:seed writes PostgreSQL only. Search scenarios also need those pages in
  // the isolated index; the guarded CLI waits for indexing before tests start.
  execFileSync(process.execPath, [
    "--conditions=react-server", "--import=tsx", "scripts/reindex-search.ts",
    "--target", target,
    "--search", `${new URL(host).origin}/${process.env.MEILI_INDEX_UID}`,
  ], {
    env: { ...process.env, MEILI_HOST: host },
    stdio: "inherit",
    timeout: 120_000,
  });
}
