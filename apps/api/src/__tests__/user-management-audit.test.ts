import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, buildAuditRow, sanitizeAuditMetadata, type Actor } from '@cio/utils/auth';

// The admin user-management service (services/organization/users.ts) writes exactly three audit
// actions. This locks in the compliant, PII-free metadata SHAPES it records — the same buildAuditRow
// path recordAudit uses. The full create→role→deactivate lifecycle + the 3 DB rows are the live matrix.

const admin: Actor = { authenticated: true, userId: 'admin-1', role: 'ADMIN', status: 'ACTIVE', orgId: 'org-1' };

describe('user-management audit metadata is id/enum-only (no PII)', () => {
  it('user.created — metadata carries the role id only', () => {
    const { clean, stripped } = sanitizeAuditMetadata({ role: 3 });
    expect(stripped).toEqual([]);
    const row = buildAuditRow({
      actor: admin,
      action: AUDIT_ACTIONS.USER_CREATED,
      entityType: 'user',
      entityId: 'u-9',
      metadata: { role: 3 }
    });
    expect(row.action).toBe('user.created');
    expect(row.actorUserId).toBe('admin-1');
    expect(row.entityId).toBe('u-9');
    expect(row.metadata).toEqual({ role: 3 });
    expect(clean).toEqual({ role: 3 });
  });

  it('user.role_changed — from→to role ids only', () => {
    const row = buildAuditRow({
      actor: admin,
      action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
      entityType: 'user',
      entityId: 'u-9',
      metadata: { role_from: 3, role_to: 2 }
    });
    expect(row.action).toBe('user.role_changed');
    expect(row.metadata).toEqual({ role_from: 3, role_to: 2 });
  });

  it('user.status_changed — from→to status enum only', () => {
    const row = buildAuditRow({
      actor: admin,
      action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
      entityType: 'user',
      entityId: 'u-9',
      metadata: { status_from: 'ACTIVE', status_to: 'DEACTIVATED' }
    });
    expect(row.action).toBe('user.status_changed');
    expect(row.metadata).toEqual({ status_from: 'ACTIVE', status_to: 'DEACTIVATED' });
  });

  it('a name/email accidentally passed as metadata VALUES would be stripped', () => {
    const { clean, stripped } = sanitizeAuditMetadata({ role: 3, email: 'leak@example.com', name: 'Leaky' });
    expect(stripped.sort()).toEqual(['email', 'name']);
    expect(clean).toEqual({ role: 3 });
  });
});
