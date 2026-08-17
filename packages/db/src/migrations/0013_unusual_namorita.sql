CREATE TABLE "course_completion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_completion_learner_course_unique" UNIQUE("learner_id","course_id")
);
--> statement-breakpoint
ALTER TABLE "course_completion" ADD CONSTRAINT "course_completion_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_completion" ADD CONSTRAINT "course_completion_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_course_completion_course" ON "course_completion" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "idx_course_completion_learner" ON "course_completion" USING btree ("learner_id");