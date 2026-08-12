import { describe, expect, it } from 'vitest';
import {
  canAccessConfig,
  canManageUsers,
  isAllocatedTutor,
  isProviderWideReader,
  isSelf,
  sameOrg,
  type Actor
} from '@cio/utils/auth';

// Pure ownership/scope predicates — the decision core the API guards compose. No DB, no request.

const learner: Actor = { authenticated: true, userId: 'u-learner', role: 'LEARNER', status: 'ACTIVE', orgId: 'org-1' };
const tutor: Actor = { authenticated: true, userId: 'u-tutor', role: 'TUTOR', status: 'ACTIVE', orgId: 'org-1' };
const manager: Actor = { authenticated: true, userId: 'u-manager', role: 'MANAGER', status: 'ACTIVE', orgId: 'org-1' };
const admin: Actor = { authenticated: true, userId: 'u-admin', role: 'ADMIN', status: 'ACTIVE', orgId: 'org-1' };
const anon: Actor = { authenticated: false, reason: 'anonymous' };
const deactivated: Actor = { authenticated: false, reason: 'deactivated', userId: 'u-x' };

describe('isSelf', () => {
  it('true only when the actor is the target user', () => {
    expect(isSelf(learner, 'u-learner')).toBe(true);
    expect(isSelf(learner, 'u-tutor')).toBe(false);
  });
  it('false for anonymous/deactivated and for null/undefined targets (no widening)', () => {
    expect(isSelf(anon, 'u-learner')).toBe(false);
    expect(isSelf(deactivated, 'u-x')).toBe(false);
    expect(isSelf(learner, null)).toBe(false);
    expect(isSelf(learner, undefined)).toBe(false);
  });
});

describe('isAllocatedTutor — the Phase-3 seam, denies in Phase 1', () => {
  it('always false (no allocation table yet), for every role', () => {
    expect(isAllocatedTutor(tutor, 'u-learner')).toBe(false);
    expect(isAllocatedTutor(admin, 'u-learner')).toBe(false);
    expect(isAllocatedTutor(tutor, null)).toBe(false);
  });
});

describe('canManageUsers / canAccessConfig — Admin only', () => {
  it('only ADMIN passes', () => {
    for (const p of [canManageUsers, canAccessConfig]) {
      expect(p(admin)).toBe(true);
      expect(p(manager)).toBe(false);
      expect(p(tutor)).toBe(false);
      expect(p(learner)).toBe(false);
      expect(p(anon)).toBe(false);
    }
  });
});

describe('isProviderWideReader — Admin or Manager', () => {
  it('ADMIN and MANAGER pass; TUTOR/LEARNER/anon do not', () => {
    expect(isProviderWideReader(admin)).toBe(true);
    expect(isProviderWideReader(manager)).toBe(true);
    expect(isProviderWideReader(tutor)).toBe(false);
    expect(isProviderWideReader(learner)).toBe(false);
    expect(isProviderWideReader(anon)).toBe(false);
  });
});

describe('sameOrg — the client org claim must equal the resolved org', () => {
  it('true only for a matching org id', () => {
    expect(sameOrg(admin, 'org-1')).toBe(true);
    expect(sameOrg(admin, 'org-2')).toBe(false);
  });
  it('false for anonymous and for null/undefined claims', () => {
    expect(sameOrg(anon, 'org-1')).toBe(false);
    expect(sameOrg(admin, null)).toBe(false);
    expect(sameOrg(admin, undefined)).toBe(false);
  });
});
