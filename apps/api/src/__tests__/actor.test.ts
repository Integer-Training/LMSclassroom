import { describe, expect, it } from 'vitest';
import { buildActor } from '@cio/utils/auth';
import { ROLE, MEMBER_STATUS } from '@cio/utils/constants/roles';

// Unit tests for the single actor-resolution core (pure — no DB). resolveActor() in
// @cio/db does the fresh read then calls buildActor; the authorization decisions live here.

const ORG = 'org-1';
const USER = 'user-1';

describe('buildActor — role resolution', () => {
  it('resolves each of the four roles to its canonical name', () => {
    const cases = [
      { roleId: ROLE.ADMIN, name: 'ADMIN' },
      { roleId: ROLE.MANAGER, name: 'MANAGER' },
      { roleId: ROLE.TUTOR, name: 'TUTOR' },
      { roleId: ROLE.LEARNER, name: 'LEARNER' }
    ] as const;
    for (const { roleId, name } of cases) {
      const actor = buildActor({ userId: USER, orgId: ORG, roleId, status: MEMBER_STATUS.ACTIVE });
      expect(actor.authenticated).toBe(true);
      if (actor.authenticated) {
        expect(actor.role).toBe(name);
        expect(actor.status).toBe('ACTIVE');
        expect(actor.userId).toBe(USER);
        expect(actor.orgId).toBe(ORG);
      }
    }
  });
});

describe('buildActor — deny-by-default', () => {
  it('no user → anonymous (unauthenticated)', () => {
    const actor = buildActor({ userId: null, orgId: ORG, roleId: ROLE.ADMIN, status: 'ACTIVE' });
    expect(actor.authenticated).toBe(false);
    if (!actor.authenticated) expect(actor.reason).toBe('anonymous');
  });

  it('deactivated → denied even with a valid role', () => {
    const actor = buildActor({ userId: USER, orgId: ORG, roleId: ROLE.ADMIN, status: MEMBER_STATUS.DEACTIVATED });
    expect(actor.authenticated).toBe(false);
    if (!actor.authenticated) expect(actor.reason).toBe('deactivated');
  });

  it('no membership (no org/roleId) → denied', () => {
    const actor = buildActor({ userId: USER, orgId: null, roleId: null, status: 'ACTIVE' });
    expect(actor.authenticated).toBe(false);
    if (!actor.authenticated) expect(actor.reason).toBe('no-membership');
  });

  it('unrecognised roleId → denied', () => {
    const actor = buildActor({ userId: USER, orgId: ORG, roleId: 99, status: 'ACTIVE' });
    expect(actor.authenticated).toBe(false);
    if (!actor.authenticated) expect(actor.reason).toBe('unknown-role');
  });
});
