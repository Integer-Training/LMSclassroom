-- course_newsfeed_comment.reply_to_comment_id was added to schema.ts and the drizzle snapshots upstream
-- (ClassroomIO e79d920ae) without a SQL migration, so production never got the column and every newsfeed
-- comment insert failed ("Failed to create newsfeed comment"). Additive only: a nullable column plus its FK.
-- IF NOT EXISTS / the DO block make this a no-op on a database that already has them.
ALTER TABLE "course_newsfeed_comment" ADD COLUMN IF NOT EXISTS "reply_to_comment_id" bigint;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'course_newsfeed_comment_reply_to_comment_id_fkey') THEN
    ALTER TABLE "course_newsfeed_comment" ADD CONSTRAINT "course_newsfeed_comment_reply_to_comment_id_fkey" FOREIGN KEY ("reply_to_comment_id") REFERENCES "public"."course_newsfeed_comment"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
