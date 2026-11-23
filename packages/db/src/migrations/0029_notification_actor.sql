-- notification.actor_id / variant: who caused a notification (learner / tutor / message sender) and, for
-- submission.created / result.recorded, the submission type (draft | final). Additive only: two nullable columns,
-- no FK, no default, no backfill — existing rows keep NULL and the reader falls back to the generic wording.
-- IF NOT EXISTS makes this a no-op on a database that already has them.
ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "actor_id" uuid;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "variant" varchar;
