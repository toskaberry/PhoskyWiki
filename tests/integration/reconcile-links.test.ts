import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, expect, it } from "vitest";
import { seedDatabase } from "@/db/seed";

const execute = promisify(execFile);
const database = decodeURIComponent(new URL(process.env.DATABASE_URL!).pathname.slice(1));
async function run(args: string[], env = process.env) {
  try {
    const result = await execute(process.execPath, ["--conditions", "react-server", "--import", "tsx", "scripts/reconcile-links.ts", ...args], { env: { ...env, MEILI_HOST: "" } });
    return { code: 0, report: JSON.parse(result.stdout) };
  } catch (error) {
    const result = error as { code: number; stdout: string };
    return { code: result.code, report: JSON.parse(result.stdout) };
  }
}

beforeAll(async () => { await seedDatabase(); });

it("运维命令在连接数据库前拒绝错误目标和未明确选择的范围", async () => {
  const result = await run(["--database", "different_database", "--all"], {
    ...process.env, DATABASE_URL: "postgresql://localhost:1/expected_database",
  });
  expect(result).toMatchObject({ code: 1, report: { error: { message: "--database 与 DATABASE_URL 的数据库名不一致，未执行校对" } } });
  expect((await run(["--database", database])).code).toBe(1);
  expect((await run(["--database", database, "--all", "--page-id", "1"])).code).toBe(1);
  expect((await run(["--database", database, "--page-id", "0"])).code).toBe(1);
}, 30_000);

it("全量校对的公开报告在重复运行时保持稳定，并明确搜索未配置的状态", async () => {
  const first = await run(["--database", database, "--all"]);
  expect(first.code).toBe(0);
  expect(first.report).toMatchObject({ scope: "all", processed: 443, failed: 0, unresolvedLinks: 4, failures: [], searchSync: "disabled: MEILI_HOST is not configured" });
  expect(await run(["--database", database, "--all"])).toEqual(first);
}, 120_000);
