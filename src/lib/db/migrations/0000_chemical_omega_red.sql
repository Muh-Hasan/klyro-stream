CREATE TYPE "public"."auth_provider" AS ENUM('local', 'google');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'club_owner', 'viewer');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" text,
	"provider" "auth_provider" DEFAULT 'local' NOT NULL,
	"provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
