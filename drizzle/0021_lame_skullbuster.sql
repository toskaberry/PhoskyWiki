CREATE TYPE "public"."agree_target" AS ENUM('page_comment');--> statement-breakpoint
CREATE TABLE "agrees" (
	"user_id" text NOT NULL,
	"target_type" "agree_target" NOT NULL,
	"target_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agrees_pk" PRIMARY KEY("user_id","target_type","target_id")
);
--> statement-breakpoint
ALTER TABLE "agrees" ADD CONSTRAINT "agrees_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agrees_target_idx" ON "agrees" USING btree ("target_type","target_id");