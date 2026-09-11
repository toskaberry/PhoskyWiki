-- ADR-0007: remove the site editorial authority and its history permanently.
-- Drizzle executes this migration in a transaction; freeze content writes while
-- collecting the affected identities, including renamed or soft-deleted boards.
LOCK TABLE "pages", "interpreters", "perspectives", "revisions", "submissions", "links"
  IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
CREATE TEMP TABLE removed_editorial_interpreters ON COMMIT DROP AS
  SELECT i.page_id FROM interpreters i JOIN pages p ON p.id = i.page_id
  WHERE i.is_editorial_board OR p.title = '编委会';--> statement-breakpoint
CREATE TEMP TABLE removed_editorial_pages ON COMMIT DROP AS
  SELECT page_id AS id FROM removed_editorial_interpreters
  UNION SELECT page_id FROM perspectives
  WHERE interpreter_id IN (SELECT page_id FROM removed_editorial_interpreters);--> statement-breakpoint
CREATE TEMP TABLE removed_editorial_revisions ON COMMIT DROP AS
  SELECT id FROM revisions WHERE page_id IN (SELECT id FROM removed_editorial_pages);--> statement-breakpoint
CREATE TEMP TABLE removed_editorial_submissions ON COMMIT DROP AS
  SELECT id FROM submissions
  WHERE page_id IN (SELECT id FROM removed_editorial_pages)
     OR interpreter_id IN (SELECT page_id FROM removed_editorial_interpreters)
     OR (kind = 'new_term' AND btrim(content) <> '');--> statement-breakpoint
UPDATE submissions SET supersedes_id = NULL
  WHERE supersedes_id IN (SELECT id FROM removed_editorial_submissions);--> statement-breakpoint
DELETE FROM submissions WHERE id IN (SELECT id FROM removed_editorial_submissions);--> statement-breakpoint
UPDATE submissions SET base_revision_id = NULL
  WHERE base_revision_id IN (SELECT id FROM removed_editorial_revisions);--> statement-breakpoint
UPDATE revisions SET rollback_from_id = NULL
  WHERE rollback_from_id IN (SELECT id FROM removed_editorial_revisions);--> statement-breakpoint
-- Preserve references in surviving content as unresolved links, without a live
-- destination. Source links, votes, notifications and interests cascade away.
UPDATE links SET target_page_id = NULL
  WHERE target_page_id IN (SELECT id FROM removed_editorial_pages);--> statement-breakpoint
UPDATE search_maintenance SET degraded = true, last_reindex_result = 'required'
  WHERE EXISTS (SELECT 1 FROM removed_editorial_pages);--> statement-breakpoint
DELETE FROM pages WHERE id IN (SELECT id FROM removed_editorial_pages);--> statement-breakpoint
ALTER TABLE "interpreters" DROP COLUMN "is_editorial_board";--> statement-breakpoint
ALTER TABLE "perspectives" DROP COLUMN "pinned_at";
