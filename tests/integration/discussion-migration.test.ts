import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, expect, it } from "vitest";

const source = new URL(process.env.DATABASE_URL!);
const database = `discussion_${randomUUID().replaceAll("-", "")}_test`;
const admin = new Pool({ connectionString: source.href });
const url = new URL(source);
url.pathname = `/${database}`;
const pool = new Pool({ connectionString: url.href });
let oldMigrations: string;
const migration = () => readFile("drizzle/0025_discussion_migration.sql", "utf8");

beforeAll(async () => {
  await admin.query(`CREATE DATABASE "${database}"`);
  oldMigrations = await mkdtemp(join(tmpdir(), "phosky-discussion-migration-"));
  await mkdir(join(oldMigrations, "meta"));
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 23);
  await writeFile(join(oldMigrations, "meta/_journal.json"), JSON.stringify(journal));
  for (const entry of journal.entries) await copyFile(`drizzle/${entry.tag}.sql`, join(oldMigrations, `${entry.tag}.sql`));
  await migrate(drizzle(pool), { migrationsFolder: oldMigrations });
}, 30_000);

afterAll(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.end();
  if (oldMigrations) await rm(oldMigrations, { recursive: true, force: true });
});

it("保留页面归属、正文、作者、时间、删除留痕与锁定，重复迁移不会重建已删除内容", async () => {
  await pool.query(`
    INSERT INTO "user" (id, name, email) VALUES ('editor', '编者', 'migration@example.test');
    INSERT INTO pages (id, type, title, slug) VALUES (1, 'term', '词条', 'term'), (2, 'interpreter', '诠释者', 'interpreter'), (3, 'perspective', '视角', 'perspective');
    INSERT INTO terms (page_id) VALUES (1);
    INSERT INTO interpreters (page_id) VALUES (2);
    INSERT INTO perspectives (page_id, term_id, interpreter_id) VALUES (3, 1, 2);
    INSERT INTO page_comments (page_id, author_id, content) VALUES (1, 'editor', '已有评论');
    INSERT INTO discussion_posts (id, term_id, perspective_id, parent_id, content, author_id, created_at, deleted_at, deleted_by) VALUES
      (1, 1, NULL, NULL, '词条旧讨论', 'editor', '2020-01-01Z', NULL, NULL),
      (2, 1, 3, NULL, '视角旧讨论', 'editor', '2020-01-02Z', '2021-01-01Z', 'editor'),
      (3, 1, NULL, 2, '较晚回复', 'editor', '2020-01-04Z', NULL, NULL),
      (4, 1, NULL, 2, '较早已删回复', 'editor', '2020-01-03Z', '2021-01-02Z', 'editor');
    INSERT INTO term_discussions (term_id, locked_at, locked_by) VALUES (1, '2022-01-01Z', 'editor');
    INSERT INTO search_maintenance (index_uid, last_reindex_result) VALUES ('pages-test', 'success');
  `);
  // A missing migration is an empty operation, so the first failure names the missing behavior.
  const sql = await migration().catch(() => "SELECT 1");
  await pool.query(sql);
  const comments = (await pool.query("SELECT id, page_id, author_id, content, created_at, deleted_at, deleted_by FROM page_comments ORDER BY id")).rows;
  expect(comments.map(row => row.content)).toEqual(['已有评论', '词条旧讨论', '视角旧讨论']);
  // 无视角锚点的旧楼层 → 词条总评论；带视角锚点的 → 该视角评论
  expect(comments[1]).toMatchObject({ page_id: 1, author_id: 'editor', created_at: new Date('2020-01-01Z'), deleted_at: null });
  expect(comments[2]).toMatchObject({ page_id: 3, author_id: 'editor', created_at: new Date('2020-01-02Z'), deleted_at: new Date('2021-01-01Z'), deleted_by: 'editor' });
  const replies = (await pool.query("SELECT * FROM replies ORDER BY created_at, id")).rows;
  expect(replies.map(row => row.content)).toEqual(['较早已删回复', '较晚回复']);
  // 旧回复接到迁移后的那条评论上（新评论区自行分配 id，归属按映射一一对应）
  expect(replies[0]).toMatchObject({ target_type: 'page_comment', target_id: comments[2].id, author_id: 'editor', created_at: new Date('2020-01-03Z'), deleted_at: new Date('2021-01-02Z'), deleted_by: 'editor' });
  expect(replies[1]).toMatchObject({ target_id: comments[2].id, created_at: new Date('2020-01-04Z') });
  expect((await pool.query('SELECT * FROM term_discussions')).rows).toEqual([{ term_id: 1, locked_at: new Date('2022-01-01Z'), locked_by: 'editor' }]);
  await pool.query(sql);
  expect((await pool.query('SELECT count(*)::int AS n FROM page_comments')).rows[0].n).toBe(3);
  expect((await pool.query('SELECT count(*)::int AS n FROM replies')).rows[0].n).toBe(2);
  await pool.query('DELETE FROM replies');
  await pool.query('DELETE FROM page_comments WHERE id = ANY($1)', [[comments[1].id, comments[2].id]]);
  await pool.query(sql);
  expect((await pool.query('SELECT content FROM page_comments')).rows).toEqual([{ content: '已有评论' }]);
  expect((await pool.query('SELECT count(*)::int AS n FROM replies')).rows[0].n).toBe(0);
  expect((await pool.query('SELECT degraded, last_reindex_result FROM search_maintenance')).rows).toEqual([{ degraded: true, last_reindex_result: 'required' }]);
}, 30_000);
