// recordAudit — the one server-side way to write an audit_event row.
//
// Best-effort: an audit write must NEVER break the business action, so failures are logged
// and swallowed. metadata is sanitised (PII values stripped) before it is written — see
// docs/AUDIT.md for the no-PII rule and the action-name convention. Call-sites are wired by
// the steps that own each action (Phase 1: user management + profile edits in Steps 6–7).

import { db } from './drizzle';
import { auditEvent } from './schema';
import { buildAuditRow, sanitizeAuditMetadata, type RecordAuditInput } from '@cio/utils/auth';

export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    const { stripped } = sanitizeAuditMetadata(input.metadata);
    if (stripped.length > 0) {
      // A caller tried to record PII values — the sanitiser removed them. Surface the bug
      // in logs (dev signal) without leaking the values.
      console.warn(
        `recordAudit(${input.action}): stripped disallowed PII-value keys from metadata: ${stripped.join(', ')}`
      );
    }
    const row = buildAuditRow(input);
    await db.insert(auditEvent).values(row);
  } catch (error) {
    console.error(`recordAudit(${input.action}) failed:`, error);
  }
}

export { buildAuditRow, sanitizeAuditMetadata, assertAuditMetadataSafe, AUDIT_ACTIONS } from '@cio/utils/auth';
export type { AuditRow, RecordAuditInput, AuditAction } from '@cio/utils/auth';
