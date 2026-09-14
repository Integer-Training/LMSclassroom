ALTER TABLE "coursework_result" ADD COLUMN "feedback_files" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "coursework_submission" ADD COLUMN "comment" text;