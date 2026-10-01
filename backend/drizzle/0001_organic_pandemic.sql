CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'rejected', 'revoked', 'expired');--> statement-breakpoint
CREATE TABLE "club_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"role" "user_role" NOT NULL,
	"invited_by" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "club_invitations" ADD CONSTRAINT "club_invitations_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_invitations" ADD CONSTRAINT "club_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "club_invitations_token_uniq" ON "club_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "club_invitations_pending_uniq" ON "club_invitations" USING btree ("club_id","email") WHERE "club_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "club_invitations_email_idx" ON "club_invitations" USING btree ("email");