CREATE TABLE "system_event_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_type" text NOT NULL,
	"severity" text NOT NULL,
	"user_id" uuid,
	"user_email" text,
	"ip_masked" text,
	"path" text,
	"method" text,
	"http_status" integer,
	"message" text,
	"stack" text,
	"organization_id" uuid,
	"correlation_id" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE INDEX "idx_system_event_log_org_occurred" ON "system_event_log" USING btree ("organization_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_system_event_log_event_type" ON "system_event_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_system_event_log_severity" ON "system_event_log" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_system_event_log_occurred_at" ON "system_event_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idx_system_event_log_user_email" ON "system_event_log" USING btree ("user_email");