import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PearlLMS scalability Phase C2 — getFirstOrganization / getFirstOrganizationWithPlans were queried on every
// navigation / signup guard / profile read. Now cached in-process (30s), invalidated by the writers, killable with
// ORG_CACHE_TTL_MS=0. The DB is a scripted fake that counts queries.

const state = vi.hoisted(() => ({
  queries: 0,
  org: null as null | Record<string, unknown>,
  fail: false
}));

vi.mock('@cio/db/drizzle', () => {
  const run = () => {
    state.queries += 1;
    if (state.fail) return Promise.reject(new Error('db down'));

    return Promise.resolve(state.org ? [state.org] : []);
  };
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'from', 'orderBy', 'where', 'set', 'values']) chain[name] = () => chain;
  chain.limit = run;
  chain.returning = run;
  // `db.update(...).set(...).where(...).returning()` and `db.delete(...).where(...)`
  chain.update = () => chain;
  chain.delete = () => ({ where: () => Promise.resolve() });
  chain.insert = () => chain;

  return { db: chain };
});

import { getFirstOrganization } from '@cio/db/queries/organization';
import { invalidateOrgCache } from '@cio/db/queries/organization/org-cache';
import { updateOrganization } from '@cio/db/queries/organization';

const ORG = { id: 'o1', name: 'Pearl', theme: 'blue' };

beforeEach(() => {
  state.queries = 0;
  state.fail = false;
  state.org = { ...ORG };
  delete process.env.ORG_CACHE_TTL_MS;
  invalidateOrgCache();
});

afterEach(() => {
  delete process.env.ORG_CACHE_TTL_MS;
  vi.useRealTimers();
});

describe('getFirstOrganization cache', () => {
  it('serves repeat reads from memory', async () => {
    expect((await getFirstOrganization())?.id).toBe('o1');
    expect((await getFirstOrganization())?.id).toBe('o1');
    expect(state.queries).toBe(1);
  });

  it('concurrent reads share one query', async () => {
    await Promise.all([getFirstOrganization(), getFirstOrganization(), getFirstOrganization()]);
    expect(state.queries).toBe(1);
  });

  it('returns a copy: mutating a result never leaks into the cache', async () => {
    const first = await getFirstOrganization();
    (first as { name: string }).name = 'MUTATED';

    expect((await getFirstOrganization())?.name).toBe('Pearl');
  });

  it('invalidateOrgCache() (called by the org / plan writers) forces a re-read', async () => {
    await getFirstOrganization();
    invalidateOrgCache();
    await getFirstOrganization();
    expect(state.queries).toBe(2);
  });

  it('an org update written through this process shows immediately', async () => {
    await getFirstOrganization();
    state.org = { ...ORG, name: 'Renamed' };
    await updateOrganization('o1', { name: 'Renamed' });

    expect((await getFirstOrganization())?.name).toBe('Renamed');
  });

  it('ORG_CACHE_TTL_MS=0 disables the cache (kill switch)', async () => {
    process.env.ORG_CACHE_TTL_MS = '0';
    await getFirstOrganization();
    await getFirstOrganization();
    expect(state.queries).toBe(2);
  });

  it('a missing org (first-run) is cached for at most ~2s, so setup is noticed quickly', async () => {
    vi.useFakeTimers();
    state.org = null;
    expect(await getFirstOrganization()).toBeNull();
    expect(await getFirstOrganization()).toBeNull();
    expect(state.queries).toBe(1);

    state.org = { ...ORG };
    await vi.advanceTimersByTimeAsync(2100);
    expect((await getFirstOrganization())?.id).toBe('o1');
    expect(state.queries).toBe(2);
  });

  it('a DB error is never cached', async () => {
    state.fail = true;
    await expect(getFirstOrganization()).rejects.toThrow('db down');

    state.fail = false;
    expect((await getFirstOrganization())?.id).toBe('o1');
  });
});
