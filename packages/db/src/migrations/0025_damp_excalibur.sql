CREATE TABLE "tutor_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"tutor_id" uuid,
	"tutor_name" varchar NOT NULL,
	"milestone" integer NOT NULL,
	"overall_rating" integer NOT NULL,
	"communication_rating" integer,
	"helpfulness_rating" integer,
	"knowledge_rating" integer,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tutor_feedback" ADD CONSTRAINT "tutor_feedback_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_feedback" ADD CONSTRAINT "tutor_feedback_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_feedback" ADD CONSTRAINT "tutor_feedback_tutor_id_fkey" FOREIGN KEY ("tutor_id") REFERENCES "public"."profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tutor_feedback_learner_milestone_unique" ON "tutor_feedback" USING btree ("learner_id","milestone");--> statement-breakpoint
CREATE INDEX "idx_tutor_feedback_org" ON "tutor_feedback" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_tutor_feedback_tutor" ON "tutor_feedback" USING btree ("tutor_id");