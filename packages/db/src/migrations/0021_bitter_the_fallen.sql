CREATE TABLE "unit_time_monthly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"year_month" varchar(7) NOT NULL,
	"seconds" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_time_monthly_learner_course_month_unique" UNIQUE("learner_id","course_id","year_month")
);
--> statement-breakpoint
ALTER TABLE "unit_time_monthly" ADD CONSTRAINT "unit_time_monthly_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_time_monthly" ADD CONSTRAINT "unit_time_monthly_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_unit_time_monthly_learner" ON "unit_time_monthly" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "idx_unit_time_monthly_learner_month" ON "unit_time_monthly" USING btree ("learner_id","year_month");