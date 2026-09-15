-- 划线感想（spec 0009 #73/#74）。
-- 全部语句幂等：迁移回归测试会整段重放本文件，验证「重复迁移不重建内容」。
DO $$ BEGIN
  CREATE TYPE "public"."thought_visibility" AS ENUM('public', 'private');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
-- 多态目标枚举扩位不能用 `ALTER TYPE ... ADD VALUE`：drizzle 迁移整体在一个事务里执行，
-- 新枚举值在同事务内不可用（PostgreSQL 限制）。改为整型重建：改名旧类型 → 建新类型
-- → 切列（USING 文本中转）→ 删旧类型，全程事务内安全。
ALTER TYPE "public"."agree_target" RENAME TO "agree_target_old";--> statement-breakpoint
CREATE TYPE "public"."agree_target" AS ENUM('page_comment', 'passage_thought');--> statement-breakpoint
ALTER TABLE "agrees" ALTER COLUMN "target_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "agrees" ALTER COLUMN "target_type" SET DATA TYPE "public"."agree_target" USING "target_type"::"public"."agree_target";--> statement-breakpoint
DROP TYPE "public"."agree_target_old";--> statement-breakpoint
ALTER TYPE "public"."reply_target" RENAME TO "reply_target_old";--> statement-breakpoint
CREATE TYPE "public"."reply_target" AS ENUM('page_comment', 'passage_thought');--> statement-breakpoint
ALTER TABLE "replies" ALTER COLUMN "target_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "replies" ALTER COLUMN "target_type" SET DATA TYPE "public"."reply_target" USING "target_type"::"public"."reply_target";--> statement-breakpoint
DROP TYPE "public"."reply_target_old";--> statement-breakpoint
DO $$ BEGIN
  CREATE TABLE "passage_thoughts" (
	"id" serial PRIMARY KEY NOT NULL,
	"page_id" integer NOT NULL,
	"author_id" text NOT NULL,
	"content" text NOT NULL,
	"visibility" "thought_visibility" DEFAULT 'public' NOT NULL,
	"anchor_start" integer NOT NULL,
	"anchor_end" integer NOT NULL,
	"quote" text NOT NULL,
	"base_revision_id" integer NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passage_thoughts_content_length" CHECK (char_length("passage_thoughts"."content") between 1 and 2000),
	CONSTRAINT "passage_thoughts_anchor_range" CHECK ("passage_thoughts"."anchor_start" >= 0 and "passage_thoughts"."anchor_end" > "passage_thoughts"."anchor_start"),
	CONSTRAINT "passage_thoughts_quote_length" CHECK (char_length("passage_thoughts"."quote") between 1 and 10000)
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "passage_thoughts" ADD CONSTRAINT "passage_thoughts_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "passage_thoughts" ADD CONSTRAINT "passage_thoughts_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "passage_thoughts" ADD CONSTRAINT "passage_thoughts_base_revision_id_revisions_id_fk" FOREIGN KEY ("base_revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "passage_thoughts" ADD CONSTRAINT "passage_thoughts_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "passage_thoughts_page_idx" ON "passage_thoughts" USING btree ("page_id","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "passage_thoughts_author_idx" ON "passage_thoughts" USING btree ("author_id");
