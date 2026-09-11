import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

// A fresh database per file, never the site's database. The suite's connection
// must itself name a test database before we even connect to PostgreSQL.
const source = new URL(process.env.DATABASE_URL!);
if (!source.pathname.endsWith("_test")) throw new Error("bootstrap tests require an isolated *_test database");
const database = `bootstrap_${randomUUID().replaceAll("-", "")}_test`;
const admin = new Pool({ connectionString: source.href });
const url = new URL(source);
url.pathname = `/${database}`;
const db = new Pool({ connectionString: url.href });
const target = `${url.hostname}:${url.port || "5432"}/${database}/${decodeURIComponent(url.username)}`;
let directory: string;
let credentials: string;
const admins = [
  { name: "首位管理员", email: "first@example.com", password: randomUUID() },
  { name: "第二位管理员", email: "second@example.com", password: randomUUID() },
];

function run(command: string, args: string[] = [], env: Record<string, string | undefined> = {}) {
  return runScript("scripts/production.ts", [command, "--target", target, ...args], env);
}

function runScript(script: string, args: string[], env: Record<string, string | undefined> = {}) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--conditions=react-server", "--import=tsx", script, ...args], {
      env: { ...process.env, NODE_ENV: "production", DATABASE_URL: url.href, BETTER_AUTH_URL: "http://localhost:3000", BETTER_AUTH_SECRET: "isolated-test-signing-secret-0123456789abcdef", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, output }));
  });
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "phosky-bootstrap-"));
  credentials = join(directory, "admins.json");
  await writeFile(credentials, JSON.stringify(admins), { mode: 0o600 });
  await admin.query(`CREATE DATABASE "${database}"`);
  expect(await run("migrate")).toMatchObject({ code: 0 });
}, 30_000);

beforeEach(async () => {
  await db.query('DELETE FROM pages');
  await db.query('DELETE FROM "user"');
  await writeFile(credentials, JSON.stringify(admins));
});

it("错误目标和缺失配置在写入之前失败且不泄露秘密", async () => {
  const before = (await db.query('SELECT * FROM "user" ORDER BY id')).rows;
  for (const result of [
    await run("bootstrap", ["--credentials", credentials, "--target", "wrong:5432/production/admin"]),
    await run("bootstrap", ["--credentials", credentials], { BETTER_AUTH_SECRET: "" }),
    await run("bootstrap"),
    await run("bootstrap", ["--credentials", credentials], { DATABASE_URL: `${url.href}?host=production` }),
  ]) {
    expect(result.code).toBe(1);
    for (const editor of admins) expect(result.output).not.toContain(editor.password);
    expect(result.output).not.toContain(url.password);
  }
  expect((await db.query('SELECT * FROM "user" ORDER BY id')).rows).toEqual(before);
}, 30_000);

it("第二位邮箱是普通编者时整次初始化失败，不创建第一位或静默提权", async () => {
  await db.query('DELETE FROM "user"');
  await db.query("DELETE FROM pages");
  await db.query('INSERT INTO "user" (id, name, email, role) VALUES ($1, $2, $3, $4)', ["conflict", "普通编者", admins[1].email, "editor"]);
  const result = await run("bootstrap", ["--credentials", credentials]);
  expect(result).toMatchObject({ code: 1 });
  expect(result.output).toContain("ADMIN_CONFLICT");
  expect((await db.query('SELECT role FROM "user"')).rows).toEqual([{ role: "editor" }]);
  expect((await db.query("SELECT * FROM pages")).rowCount).toBe(0);
  expect((await db.query("SELECT * FROM account")).rowCount).toBe(0);
}, 30_000);

it("数据库写入失败回滚全部账号；恢复约束后可重试", async () => {
  await db.query('DELETE FROM "user"');
  await db.query('ALTER TABLE "user" ADD CONSTRAINT bootstrap_failure CHECK (email <> \'second@example.com\')');
  try {
    expect(await run("bootstrap", ["--credentials", credentials])).toMatchObject({ code: 1 });
    expect((await db.query('SELECT * FROM "user"')).rowCount).toBe(0);
    expect((await db.query("SELECT * FROM account")).rowCount).toBe(0);
  } finally {
    await db.query('ALTER TABLE "user" DROP CONSTRAINT bootstrap_failure');
  }
  expect(await run("bootstrap", ["--credentials", credentials])).toMatchObject({ code: 0 });
}, 30_000);

it("已有半成管理员产生冲突，不擅自修复", async () => {
  expect(await run("bootstrap", ["--credentials", credentials])).toMatchObject({ code: 0 });
  await db.query('DELETE FROM account WHERE user_id IN (SELECT id FROM "user" WHERE email=$1)', [admins[0].email]);
  expect((await run("bootstrap", ["--credentials", credentials])).output).toContain("ADMIN_CREDENTIAL_CONFLICT");
}, 30_000);

afterAll(async () => {
  await db.end();
  await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.end();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it("生产进程从空库只创建两位完整管理员，并发重试保留密码和普通内容", async () => {
  const results = await Promise.all([run("bootstrap", ["--credentials", credentials]), run("bootstrap", ["--credentials", credentials])]);
  for (const result of results) {
    expect(result).toMatchObject({ code: 0 });
    for (const editor of admins) expect(result.output).not.toContain(editor.password);
  }
  expect((await db.query('SELECT role FROM "user"')).rows).toEqual([{ role: "admin" }, { role: "admin" }]);
  expect((await db.query("SELECT type, title FROM pages")).rows).toEqual([]);
  expect((await db.query("SELECT * FROM interpreters")).rows).toEqual([]);
  expect((await db.query("SELECT * FROM categories")).rowCount).toBe(0);
  const original = (await db.query('SELECT * FROM account ORDER BY id')).rows;
  const ordinary = (await db.query("INSERT INTO pages(type, title, slug) VALUES ('interpreter', '普通诠释者', 'ordinary') RETURNING id")).rows[0];
  await db.query("INSERT INTO interpreters(page_id, summary) VALUES ($1, '已经编写的正文，不允许覆盖')", [ordinary.id]);
  await writeFile(credentials, JSON.stringify(admins.map(editor => ({ ...editor, password: randomUUID() }))));
  expect(await run("bootstrap", ["--credentials", credentials])).toMatchObject({ code: 0 });
  expect((await db.query('SELECT * FROM account ORDER BY id')).rows).toEqual(original);
  expect((await db.query("SELECT summary FROM interpreters")).rows[0].summary).toBe("已经编写的正文，不允许覆盖");
}, 30_000);

it("演示 seed 在生产环境中拒绝执行，原账号与内容保留", async () => {
  expect(await run("bootstrap", ["--credentials", credentials])).toMatchObject({ code: 0 });
  const before = (await db.query('SELECT * FROM account ORDER BY id')).rows;
  for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "development", PHOSKYWIKI_ENV: "production" }]) {
    const result = await runScript("scripts/seed.ts", [], env);
    expect(result.code).toBe(1);
    expect(result.output).toContain("Demo seed is forbidden in production");
    for (const editor of admins) expect(result.output).not.toContain(editor.password);
  }
  expect((await db.query('SELECT * FROM account ORDER BY id')).rows).toEqual(before);
  expect((await db.query("SELECT type FROM pages")).rows).toEqual([]);
}, 30_000);
