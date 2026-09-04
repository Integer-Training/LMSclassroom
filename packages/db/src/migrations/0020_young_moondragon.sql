CREATE TABLE "unit_time_spent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"seconds" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_time_spent_learner_lesson_unique" UNIQUE("learner_id","lesson_id")
);
--> statement-breakpoint
ALTER TABLE "unit_time_spent" ADD CONSTRAINT "unit_time_spent_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_time_spent" ADD CONSTRAINT "unit_time_spent_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_time_spent" ADD CONSTRAINT "unit_time_spent_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_unit_time_spent_learner" ON "unit_time_spent" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "idx_unit_time_spent_course" ON "unit_time_spent" USING btree ("course_id");