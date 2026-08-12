import { describe, expect, it } from 'vitest';
import { sanitizeAuditMetadata, assertAuditMetadataSafe, buildAuditRow, AUDIT_ACTIONS } from '@cio/utils/auth';

// recordAudit (@cio/db) = buildAuditRow + db.insert (best-effort). The pure building blocks
// are tested here; the actual row write is verified against the DB separately.

describe('sanitizeAuditMetadata — no PII values', () => {
  it('strips PII-named keys holding a scalar value, keeps field-name lists + non-PII keys', () => {
    const { clean, stripped } = sanitizeAuditMetadata({
      email: 'learner@example.com', // PII value → stripped
      ni_number: 'QQ123456C', // PII value → stripped
      fields: ['email', 'address'], // field NAMES (array) → kept
      role_from: 3,
      role_to: 2
    });
    expect(stripped.sort()).toEqual(['email', 'ni_number']);
    expect(clean).toEqual({ fields: ['email', 'address'], role_from: 3, role_to: 2 });
    expect(clean).not.toHaveProperty('email');
    expect(clean).not.toHaveProperty('ni_number');
  });

  it('leaves clean metadata untouched', () => {
    const { clean, stripped } = sanitizeAuditMetadata({ fields: ['fullname', 'locale'] });
    expect(stripped).toEqual([]);
    expect(clean).toEqual({ fields: ['fullname', 'locale'] });
  });
});

describe('assertAuditMetadataSafe — throws on disallowed shapes', () => {
  it('throws when a PII value is present', () => {
    expect(() => assertAuditMetadataSafe({ email: 'a@b.com' })).toThrow(/PII/i);
  });
  it('does not throw for field-name lists', () => {
    expect(() => assertAuditMetadataSafe({ fields: ['email', 'ni_number'] })).not.toThrow();
  });
});

describe('buildAuditRow', () => {
  it('resolves an authenticated Actor to ids and sanitises metadata', () => {
    const actor = {
      authenticated: true as const,
      userId: 'admin-1',
      role: 'ADMIN' as const,
      status: 'ACTIVE' as const,
      orgId: 'org-1'
    };
    const row = buildAuditRow({
      actor,
      action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
      entityType: 'user',
      entityId: 'target-9',
      metadata: { role_from: 3, role_to: 2, email: 'leak@example.com' }
    });
    expect(row.actorUserId).toBe('admin-1');
    expect(row.organizationId).toBe('org-1');
    expect(row.action).toBe('user.role_changed');
    expect(row.entityType).toBe('user');
    expect(row.entityId).toBe('target-9');
    expect(row.metadata).toEqual({ role_from: 3, role_to: 2 }); // email stripped
  });

  it('handles a system actor (explicit ids) and empty metadata', () => {
    const row = buildAuditRow({
      actor: { userId: null, orgId: 'org-1' },
      action: AUDIT_ACTIONS.USER_CREATED,
      entityType: 'user',
      entityId: 'u-2'
    });
    expect(row.actorUserId).toBeNull();
    expect(row.organizationId).toBe('org-1');
    expect(row.metadata).toEqual({});
  });
});
