import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, expect, it } from "vitest";

const source = new URL(process.env.DATABASE_URL!);
if (!source.pathname.endsWith("_test")) throw new Error("Isolated test database required");
const database = `equal_${randomUUID().replaceAll("-", "")}_test`;
const admin = new Pool({ connectionString: source.href });
const url = new URL(source);
url.pathname = `/${database}`;
const pool = new Pool({ connectionString: url.href });
let oldMigrations: string;

beforeAll(async () => {
  await admin.query(`CREATE DATABASE "${database}"`);
  oldMigrations = await mkdtemp(join(tmpdir(), "phosky-equal-migration-"));
  await mkdir(join(oldMigrations, "meta"));
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 18);
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

it("迁移彻底清除编委会、其历史和旧默认正文提案，保留具名视角与词条讨论", async () => {
  await pool.query(`
    INSERT INTO "user" (id, name, email) VALUES ('editor', '测试编者', 'equal@example.test');
    INSERT INTO pages (id, type, title, slug) VALUES
      (1, 'interpreter', '编委会', 'board'), (2, 'interpreter', '马克思', 'marx'),
      (3, 'term', '异化', 'alienation'), (4, 'perspective', '编委会论异化', 'board-view'),
      (5, 'perspective', '马克思论异化', 'marx-view'),
      (6, 'interpreter', '已更名的旧编委会', 'renamed-board'),
      (7, 'perspective', '旧编委会历史视角', 'renamed-view');
    INSERT INTO interpreters (page_id, is_editorial_board) VALUES (1, false), (2, false), (6, true);
    INSERT INTO terms (page_id) VALUES (3);
    INSERT INTO perspectives (page_id, term_id, interpreter_id, pinned_at) VALUES
      (4, 3, 1, now()), (5, 3, 2, now()), (7, 3, 6, null);
    INSERT INTO revisions (id, page_id, content) VALUES
      (10, 4, '旧站方正文'), (11, 5, '保留的马克思解释'), (12, 1, '旧角色历史'), (13, 7, '旧更名正文');
    INSERT INTO revisions (id, page_id, content, rollback_from_id) VALUES (14, 4, '旧回滚正文', 10);
    INSERT INTO submissions (id, page_id, kind, content, base_revision_id, quorum, submitted_by) VALUES
      (20, 4, 'edit', '编委会待审正文', 14, 2, 'editor'),
      (21, 5, 'edit', '保留的普通待审', 11, 2, 'editor');
    INSERT INTO submissions (id, kind, content, title, quorum, submitted_by) VALUES
      (22, 'new_term', '隐式编委会正文', '旧向导提交', 2, 'editor'),
      (23, 'new_term', '', '保留的纯元数据', 2, 'editor');
    UPDATE submissions SET supersedes_id = 20 WHERE id = 21;
    INSERT INTO submissions (id, kind, content, term_id, interpreter_id, quorum, submitted_by)
      VALUES (24, 'new_perspective', '尚未发布的编委会视角', 3, 1, 2, 'editor');
    INSERT INTO submission_votes (submission_id, admin_id, vote) VALUES (20, 'editor', 'approve');
    INSERT INTO notifications (submission_id) VALUES (20);
    INSERT INTO links (source_page_id, target_page_id, target_name) VALUES
      (4, 3, '异化'), (5, 4, '异化@编委会'), (5, 3, '异化');
    INSERT INTO discussion_posts (term_id, perspective_id, content, author_id)
      VALUES (3, 4, '应保留的词条讨论', 'editor');
    INSERT INTO interest_tags (user_id, interpreter_id) VALUES ('editor', 1), ('editor', 2);
    INSERT INTO search_maintenance (index_uid, last_reindex_result) VALUES ('pages-test', 'success');
  `);

  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });

  expect((await pool.query("SELECT id FROM pages ORDER BY id")).rows).toEqual([{ id: 2 }, { id: 3 }, { id: 5 }]);
  expect((await pool.query("SELECT content FROM revisions ORDER BY id")).rows).toEqual([{ content: "保留的马克思解释" }]);
  expect((await pool.query("SELECT id, supersedes_id FROM submissions ORDER BY id")).rows).toEqual([
    { id: 21, supersedes_id: null }, { id: 23, supersedes_id: null },
  ]);
  expect((await pool.query("SELECT * FROM submission_votes")).rowCount).toBe(0);
  expect((await pool.query("SELECT * FROM notifications")).rowCount).toBe(0);
  expect((await pool.query("SELECT source_page_id, target_page_id, target_name FROM links ORDER BY target_name")).rows).toEqual([
    { source_page_id: 5, target_page_id: 3, target_name: "异化" },
    { source_page_id: 5, target_page_id: null, target_name: "异化@编委会" },
  ]);
  expect((await pool.query("SELECT perspective_id, content FROM discussion_posts")).rows).toEqual([{ perspective_id: null, content: "应保留的词条讨论" }]);
  expect((await pool.query("SELECT interpreter_id FROM interest_tags")).rows).toEqual([{ interpreter_id: 2 }]);
  expect((await pool.query("SELECT degraded, last_reindex_result FROM search_maintenance")).rows).toEqual([{ degraded: true, last_reindex_result: "required" }]);
  expect((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('is_editorial_board', 'pinned_at')")).rows).toEqual([]);
  // The migration journal makes retries a no-op rather than deleting ordinary data.
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  expect((await pool.query("SELECT count(*)::int AS count FROM pages")).rows[0].count).toBe(3);
}, 30_000);
