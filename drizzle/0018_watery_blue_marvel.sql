ALTER TYPE "public"."user_role" ADD VALUE 'superadmin';--> statement-breakpoint
CREATE TABLE "role_changes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "role_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"actor_id" text NOT NULL,
	"target_user_id" text NOT NULL,
	"previous_role" "user_role" NOT NULL,
	"new_role" "user_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
