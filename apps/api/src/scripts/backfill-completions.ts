/**
 * One-off backfill: write a course_completion record for every existing enrolment that ALREADY satisfies
 * the completion rule (docs/PROGRESS-MODEL.md §2). Runs through the SAME rule code + the SAME idempotent
 * ON-CONFLICT insert as the live trigger, so re-running is a safe no-op. Emits a PII-free counts+ids report.
 *
 * Run:  NODE_ENV=development npx tsx apps/api/src/scripts/backfill-completions.ts
 * Optional: BACKFILL_ACTOR_ID=<admin profile id>  (attributes the completion.recorded audit rows; else system)
 */
import { AUDIT_ACTIONS, recordAudit } from '@cio/db/audit';
import { backfillCompletions } from '@cio/db/queries/completion';

async function main() {
  const actorId = process.env.BACKFILL_ACTOR_ID ?? null;

  const report = await backfillCompletions({
    onAudit: async (row, learnerId, courseId) => {
      await recordAudit({
        actor: { userId: actorId, orgId: null },
        action: AUDIT_ACTIONS.COMPLETION_RECORDED,
        entityType: 'course_completion',
        entityId: row.id,
        // ids only — never names/emails/PII
        metadata: { learnerId, courseId, completionId: row.id }
      });
    }
  });

  // Log ids + counts only (no PII).
  console.log(
    '[backfill-completions]',
    JSON.stringify({
      scanned: report.scanned,
      newlyRecorded: report.newlyRecorded,
      alreadyRecorded: report.alreadyRecorded,
      skippedIncomplete: report.skippedIncomplete,
      insertedIds: report.insertedIds
    })
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill-completions] failed:', err);
    process.exit(1);
  });
