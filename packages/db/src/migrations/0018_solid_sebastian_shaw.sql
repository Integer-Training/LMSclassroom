CREATE TABLE "id_verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"status" varchar DEFAULT 'not_verified' NOT NULL,
	"method" varchar,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "id_verification_learner_id_key" UNIQUE("learner_id")
);
--> statement-breakpoint
ALTER TABLE "id_verification" ADD CONSTRAINT "id_verification_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "id_verification" ADD CONSTRAINT "id_verification_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "public"."profile"("id") ON DELETE set null ON UPDATE no action;