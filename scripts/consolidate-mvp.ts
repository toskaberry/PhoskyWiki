import "dotenv/config";
import { parseArgs } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { closeDatabases, getDb } from "../src/db";
import { sql } from "drizzle-orm";
import { consolidateMvp, mvpMergeGroups, type MergeGroup } from "../src/lib/consolidate-mvp";

async function main() {
  const { values } = parseArgs({ options: { database: { type: "string" }, apply: { type: "boolean", default: false }, backup: { type: "string" }, groups: { type: "string" } } });
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!values.database || decodeURIComponent(url.pathname.slice(1)) !== values.database) throw new Error("--database 必须与实际数据库名一致");
  if (values.apply && (!values.backup || !(await stat(values.backup)).isFile() || (await stat(values.backup)).size === 0)) throw new Error("执行前需提供 --backup 指向本次目标库的非空备份文件");
  let groups: MergeGroup[] = mvpMergeGroups;
  if (values.groups) {
    const input: unknown = JSON.parse(await readFile(values.groups, "utf8"));
    if (!Array.isArray(input) || input.some(g => !g || typeof g.title !== "string" || !g.title.trim() || !Array.isArray(g.sourceTitles) || g.sourceTitles.some((s: unknown) => typeof s !== "string"))) throw new Error("归并组必须包含 title 和 sourceTitles 字符串列表");
    groups = input;
  }
  const identity = await getDb().execute<{ name: string }>(sql`select current_database() as name`);
  if (identity.rows[0]?.name !== values.database) throw new Error("数据库身份不匹配");
  return { target: { host: url.hostname, port: url.port || "5432", database: values.database }, ...await consolidateMvp(values.apply, groups) };
}
main().then(report => { process.stdout.write(JSON.stringify(report, null, 2) + "\n"); process.exitCode = 0; }).catch(error => {
  // 不输出 Drizzle 包裹的 SQL 参数或内容正文。
  let cause = error;
  while (cause instanceof Error && cause.cause) cause = cause.cause;
  process.stdout.write(JSON.stringify({ error: cause instanceof Error ? cause.message : "归并失败" }) + "\n"); process.exitCode = 1;
}).finally(closeDatabases);
