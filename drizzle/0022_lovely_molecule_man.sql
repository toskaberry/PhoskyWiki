CREATE TYPE "public"."reply_target" AS ENUM('page_comment');--> statement-breakpoint
CREATE TABLE "replies" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_type" "reply_target" NOT NULL,
	"target_id" integer NOT NULL,
	"author_id" text NOT NULL,
	"content" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "replies_content_length" CHECK (char_length("replies"."content") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "page_comments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "page_comments" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "replies_target_created_idx" ON "replies" USING btree ("target_type","target_id","created_at","id");--> statement-breakpoint
ALTER TABLE "page_comments" ADD CONSTRAINT "page_comments_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;