CREATE TYPE "public"."mark_style" AS ENUM('highlight', 'underline', 'squiggle');--> statement-breakpoint
CREATE TABLE "personal_marks" (
	"id" serial PRIMARY KEY NOT NULL,
	"page_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"style" "mark_style" NOT NULL,
	"anchor_start" integer NOT NULL,
	"anchor_end" integer NOT NULL,
	"quote" text NOT NULL,
	"base_revision_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_marks_anchor_range" CHECK ("personal_marks"."anchor_start" >= 0 and "personal_marks"."anchor_end" > "personal_marks"."anchor_start"),
	CONSTRAINT "personal_marks_quote_length" CHECK (char_length("personal_marks"."quote") between 1 and 10000)
);
--> statement-breakpoint
CREATE TABLE "user_mark_style" (
	"user_id" text PRIMARY KEY NOT NULL,
	"style" "mark_style" DEFAULT 'highlight' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personal_marks" ADD CONSTRAINT "personal_marks_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_marks" ADD CONSTRAINT "personal_marks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_marks" ADD CONSTRAINT "personal_marks_base_revision_id_revisions_id_fk" FOREIGN KEY ("base_revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mark_style" ADD CONSTRAINT "user_mark_style_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "personal_marks_page_user_idx" ON "personal_marks" USING btree ("page_id","user_id","anchor_start");