CREATE TYPE "public"."member_status" AS ENUM('ACTIVE', 'DEACTIVATED');--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "status" "member_status" DEFAULT 'ACTIVE' NOT NULL;
