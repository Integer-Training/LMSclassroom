ALTER TABLE "coursework_submission" DROP CONSTRAINT "coursework_submission_learner_lesson_version_unique";--> statement-breakpoint
ALTER TABLE "coursework_result" ALTER COLUMN "result" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "coursework_result" ADD COLUMN "kind" varchar DEFAULT 'verdict' NOT NULL;--> statement-breakpoint
ALTER TABLE "coursework_submission" ADD COLUMN "assessment_key" varchar;--> statement-breakpoint
ALTER TABLE "coursework_submission" ADD COLUMN "submission_type" varchar DEFAULT 'final' NOT NULL;--> statement-breakpoint
ALTER TABLE "coursework_submission" ADD CONSTRAINT "coursework_submission_learner_lesson_assessment_version_unique" UNIQUE NULLS NOT DISTINCT("learner_id","lesson_id","assessment_key","version");