-- Phase B (docs/SCALABILITY-PLAN.md): indexes added while the tables are still tiny, so a plain
-- CREATE INDEX is instant. IF NOT EXISTS makes a hand-built CONCURRENTLY index (the large-table process in
-- docs/DEPLOY.md) a no-op here. The two groupmember indexes carry INCLUDE columns for index-only scans;
-- drizzle can't express INCLUDE, so schema.ts declares just the key columns.
CREATE INDEX IF NOT EXISTS "idx_groupmember_profile_role" ON "groupmember" USING btree ("profile_id","role_id") INCLUDE ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_groupmember_group_role" ON "groupmember" USING btree ("group_id","role_id") INCLUDE ("profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_session_user_id" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_session_expires_at" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_user_id" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_verification_identifier" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_verification_expires_at" ON "verification" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_user_created" ON "notification" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_coursework_submission_files_gin" ON "coursework_submission" USING gin ("files" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_coursework_result_feedback_files_gin" ON "coursework_result" USING gin ("feedback_files" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_course_section_course_id" ON "course_section" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lesson_section_id" ON "lesson" USING btree ("section_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_registration_pending_org_email" ON "registration" USING btree ("organization_id","email") WHERE "status" = 'pending';
