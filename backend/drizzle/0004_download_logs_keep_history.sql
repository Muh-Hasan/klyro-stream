ALTER TABLE "download_logs" DROP CONSTRAINT "download_logs_video_id_videos_id_fk";
--> statement-breakpoint
ALTER TABLE "download_logs" ALTER COLUMN "video_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "download_logs" ADD COLUMN "club_id" uuid;--> statement-breakpoint
UPDATE "download_logs" SET "club_id" = "videos"."club_id" FROM "videos" WHERE "videos"."id" = "download_logs"."video_id";--> statement-breakpoint
ALTER TABLE "download_logs" ALTER COLUMN "club_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "download_logs" ADD CONSTRAINT "download_logs_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_logs" ADD CONSTRAINT "download_logs_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "download_logs_club_downloaded_idx" ON "download_logs" USING btree ("club_id","downloaded_at");