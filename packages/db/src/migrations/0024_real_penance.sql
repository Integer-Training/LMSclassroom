ALTER TABLE "announcement" ADD COLUMN "audience_type" varchar DEFAULT 'all_learners' NOT NULL;--> statement-breakpoint
ALTER TABLE "announcement" ADD COLUMN "target_user_id" uuid;--> statement-breakpoint
ALTER TABLE "announcement" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcement" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_announcement_target_user" ON "announcement" USING btree ("target_user_id");--> statement-breakpoint
-- Backfill: existing rows with a course_id were course-scoped announcements (pre-broadcast). The new
-- audience_type column defaults to 'all_learners'; correct those legacy course rows to 'course' so they keep
-- reaching only their enrolled learners (course_id IS NULL rows stay 'all_learners', the old provider-wide).
UPDATE "announcement" SET "audience_type" = 'course' WHERE "course_id" IS NOT NULL;