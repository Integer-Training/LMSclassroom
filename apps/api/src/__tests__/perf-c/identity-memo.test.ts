import { beforeEach, describe, expect, it, vi } from 'vitest';

// PearlLMS scalability Phase C4 — one identity read per request, never cached across requests.
// The DB is replaced by a scripted fake so only the memo / actor-resolution logic runs.

type Row = { orgId: string | null; roleId: number | null; status: string | null };

const state = vi.hoisted(() => ({
  queries: 0,
  rows: [] as Array<{ orgId: string | null; roleId: number | null; status: string | null }>,
  fail: false
}));

vi.mock('@cio/db/drizzle', () => {
  const chain: Record<string, unknown> = {};
  const terminal = () => {
    state.queries += 1;
    if (state.fail) return Promise.reject(new Error('connection terminated'));

    return Promise.resolve(state.rows.map((r) => ({ ...r })));
  };
  for (const name of ['select', 'from', 'leftJoin', 'where']) chain[name] = () => chain;
  chain.orderBy = terminal;

  return { db: chain };
});

import { getUserMembershipRows, runWithRequestMemo } from '@cio/db/request-memo';
import { resolveActor } from '@cio/db/actor';

const ORG = '11111111-1111-1111-1111-111111111111';
const ORG2 = '22222222-2222-2222-2222-222222222222';
const ADMIN = 1;
const LEARNER = 3;

const setRows = (rows: Row[]) => {
  state.rows = rows;
};

beforeEach(() => {
  state.queries = 0;
  state.fail = false;
  state.rows = [];
});

describe('per-request identity memo', () => {
  it('inside one request scope, customSession + resolveActor + get-session share ONE query', async () => {
    setRows([{ orgId: ORG, roleId: ADMIN, status: 'ACTIVE' }]);

    await runWithRequestMemo(async () => {
      await getUserMembershipRows('u1'); // customSession (middleware getSession)
      await resolveActor('u1', ORG); // resolveActor
      await getUserMembershipRows('u1'); // customSession again for /api/auth/get-session
    });

    expect(state.queries).toBe(1);
  });

  it('concurrent reads in one scope share the in-flight query', async () => {
    setRows([{ orgId: ORG, roleId: ADMIN, status: 'ACTIVE' }]);

    await runWithRequestMemo(() => Promise.all([getUserMembershipRows('u1'), resolveActor('u1', null)]));

    expect(state.queries).toBe(1);
  });

  it('is NOT shared across requests: every request reads fresh', async () => {
    setRows([{ orgId: ORG, roleId: ADMIN, status: 'ACTIVE' }]);

    await runWithRequestMemo(() => resolveActor('u1', ORG));
    await runWithRequestMemo(() => resolveActor('u1', ORG));

    expect(state.queries).toBe(2);
  });

  it('outside any scope (jobs, scripts) nothing is memoised', async () => {
    setRows([{ orgId: ORG, roleId: ADMIN, status: 'ACTIVE' }]);

    await resolveActor('u1', ORG);
    await resolveActor('u1', ORG);

    expect(state.queries).toBe(2);
  });

  it('keys the memo by user id (impersonation / different users never share rows)', async () => {
    setRows([{ orgId: ORG, roleId: ADMIN, status: 'ACTIVE' }]);

    await runWithRequestMemo(async () => {
      await getUserMembershipRows('admin');
      await getUserMembershipRows('impersonated-learner');
    });

    expect(state.queries).toBe(2);
  });

  it('a failed read is rethrown (fail closed) and not replayed to later callers in the request', async () => {
    state.fail = true;

    await runWithRequestMemo(async () => {
      await expect(getUserMembershipRows('u1')).rejects.toThrow('connection terminated');
      state.fail = false;
      setRows([{ orgId: ORG, roleId: LEARNER, status: 'ACTIVE' }]);
      await expect(getUserMembershipRows('u1')).resolves.toHaveLength(1);
    });
  });
});

describe('deactivation and role change take effect on the very next request', () => {
  it('deactivate a user, then the next request is denied', async () => {
    setRows([{ orgId: ORG, roleId: ADMIN, status: 'ACTIVE' }]);
    const before = await runWithRequestMemo(() => resolveActor('u1', ORG));
    expect(before.authenticated).toBe(true);

    // an admin deactivates the user between the two requests
    setRows([{ orgId: ORG, roleId: ADMIN, status: 'DEACTIVATED' }]);
    const after = await runWithRequestMemo(() => resolveActor('u1', ORG));

    expect(after.authenticated).toBe(false);
    if (!after.authenticated) expect(after.reason).toBe('deactivated');
  });

  it('role change applies on the next request', async () => {
    setRows([{ orgId: ORG, roleId: ADMIN, status: 'ACTIVE' }]);
    const admin = await runWithRequestMemo(() => resolveActor('u1', ORG));
    expect(admin.authenticated && admin.role).toBe('ADMIN');

    setRows([{ orgId: ORG, roleId: LEARNER, status: 'ACTIVE' }]);
    const learner = await runWithRequestMemo(() => resolveActor('u1', ORG));
    expect(learner.authenticated && learner.role).toBe('LEARNER');
  });
});

describe('resolveActor semantics are unchanged', () => {
  it('unknown user id / no rows -> no-membership (deny)', async () => {
    const actor = await resolveActor('ghost', ORG);
    expect(actor.authenticated).toBe(false);
    if (!actor.authenticated) expect(actor.reason).toBe('no-membership');
  });

  it('a profile with no membership (LEFT JOIN null row) -> no-membership', async () => {
    setRows([{ orgId: null, roleId: null, status: 'ACTIVE' }]);
    const actor = await resolveActor('u1', null);
    expect(actor.authenticated).toBe(false);
    if (!actor.authenticated) expect(actor.reason).toBe('no-membership');
  });

  it('with an org id it resolves THAT membership, not another org', async () => {
    setRows([
      { orgId: ORG, roleId: LEARNER, status: 'ACTIVE' },
      { orgId: ORG2, roleId: ADMIN, status: 'ACTIVE' }
    ]);

    const inOrg2 = await resolveActor('u1', ORG2);
    expect(inOrg2.authenticated && inOrg2.orgId).toBe(ORG2);
    expect(inOrg2.authenticated && inOrg2.role).toBe('ADMIN');

    const elsewhere = await resolveActor('u1', '33333333-3333-3333-3333-333333333333');
    expect(elsewhere.authenticated).toBe(false);
  });

  it('without an org id a multi-org user gets the FIRST membership in query order (oldest first)', async () => {
    setRows([
      { orgId: ORG, roleId: LEARNER, status: 'ACTIVE' },
      { orgId: ORG2, roleId: ADMIN, status: 'ACTIVE' }
    ]);

    const actor = await resolveActor('u1', null);
    expect(actor.authenticated && actor.orgId).toBe(ORG);
  });

  it('a DB error propagates (the API turns it into 503, never an anonymous 401)', async () => {
    state.fail = true;
    await expect(resolveActor('u1', ORG)).rejects.toThrow();
  });

  it('missing user id -> anonymous without touching the DB', async () => {
    const actor = await resolveActor(null);
    expect(actor.authenticated).toBe(false);
    expect(state.queries).toBe(0);
  });
});
