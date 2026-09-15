-- 讨论区退役与迁移（spec 0009 #77）：旧讨论楼层整体并入页面评论区，旧表随后删除。
-- 本文件独立可重放（迁移回归测试会整段重放两次验证幂等）。
--
-- 源列一律写全限定（p.id / p.content …）：PostgreSQL 在 `INSERT ... SELECT ... ON CONFLICT`
-- 里把裸列名解析到目标表同名列，容易静默丢行。
-- id 不沿用旧楼层号：page_comments 可能已有评论占号（「已有评论」），沿用旧 id 会撞号，
-- 而 ON CONFLICT 会静默跳过 → 老讨论丢失。这里让新评论区自行分配 id，
-- 并用 source_id → id 的映射把旧回复接到迁移后的评论上（一一对应，不丢归属）。
-- 幂等：旧表迁移后即删除，重复执行时本段成为空操作（不会重建已删除内容）。
DO $$ BEGIN
  IF to_regclass('public.discussion_posts') IS NULL THEN
    RETURN;
  END IF;
  CREATE TEMP TABLE migration_discussion_parents ON COMMIT DROP AS
  WITH migrated AS (
    INSERT INTO "page_comments" ("page_id", "author_id", "content", "deleted_at", "deleted_by", "created_at")
    SELECT COALESCE(p."perspective_id", p."term_id"), p."author_id", p."content", p."deleted_at", p."deleted_by", p."created_at"
    FROM "discussion_posts" p
    WHERE p."parent_id" IS NULL
    RETURNING "id", "content", "created_at"
  )
  -- 顶层楼层与迁移后评论的一一对应（同内容同时间；旧楼层不存在两条完全相同）
  SELECT p."id" AS source_id, m."id" AS comment_id
  FROM "discussion_posts" p
  JOIN migrated m ON m."content" = p."content" AND m."created_at" = p."created_at"
  WHERE p."parent_id" IS NULL;

  INSERT INTO "replies" ("target_type", "target_id", "author_id", "content", "deleted_at", "deleted_by", "created_at")
  SELECT 'page_comment', parents.comment_id, p."author_id", p."content", p."deleted_at", p."deleted_by", p."created_at"
  FROM "discussion_posts" p
  JOIN migration_discussion_parents parents ON parents.source_id = p."parent_id";

  DROP TABLE "discussion_posts";
END $$;--> statement-breakpoint
-- 评论进入 Meilisearch 派生索引（沿用讨论区同步机制）：旧讨论文档已随时间失效，
-- 记一次「需重建」让运维校对把它们换成评论文档。
UPDATE "search_maintenance" SET "degraded" = true, "last_reindex_result" = 'required';
