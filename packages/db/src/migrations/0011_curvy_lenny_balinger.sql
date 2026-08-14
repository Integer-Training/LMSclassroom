CREATE TABLE "coursework_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"result" varchar NOT NULL,
	"feedback" text,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coursework_result_submission_unique" UNIQUE("submission_id")
);
--> statement-breakpoint
CREATE TABLE "coursework_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar DEFAULT 'submitted' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coursework_submission_learner_lesson_version_unique" UNIQUE("learner_id","lesson_id","version")
);
--> statement-breakpoint
CREATE TABLE "tutor_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tutor_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tutor_allocation_pair_unique" UNIQUE("tutor_id","learner_id")
);
--> statement-breakpoint
ALTER TABLE "coursework_result" ADD CONSTRAINT "coursework_result_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."coursework_submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coursework_result" ADD CONSTRAINT "coursework_result_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coursework_submission" ADD CONSTRAINT "coursework_submission_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coursework_submission" ADD CONSTRAINT "coursework_submission_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coursework_submission" ADD CONSTRAINT "coursework_submission_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_allocation" ADD CONSTRAINT "tutor_allocation_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_allocation" ADD CONSTRAINT "tutor_allocation_tutor_id_fkey" FOREIGN KEY ("tutor_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_allocation" ADD CONSTRAINT "tutor_allocation_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_allocation" ADD CONSTRAINT "tutor_allocation_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_coursework_result_submission" ON "coursework_result" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "idx_coursework_submission_learner_lesson" ON "coursework_submission" USING btree ("learner_id","lesson_id");--> statement-breakpoint
CREATE INDEX "idx_coursework_submission_course" ON "coursework_submission" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "idx_tutor_allocation_tutor" ON "tutor_allocation" USING btree ("tutor_id");--> statement-breakpoint
CREATE INDEX "idx_tutor_allocation_learner" ON "tutor_allocation" USING btree ("learner_id");