CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"organization_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_audit_event_actor" ON "audit_event" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "idx_audit_event_org" ON "audit_event" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_audit_event_action" ON "audit_event" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_audit_event_entity" ON "audit_event" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_audit_event_occurred_at" ON "audit_event" USING btree ("occurred_at");