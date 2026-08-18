import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 6 Step 6 — notification preferences SERVICE. Proves: reads/writes use the ACTOR's own id;
// effective values come from the SAME framework resolution (getCategoryEmailEnabled = row ?? config default);
// an unknown category is rejected; anon refused. The queries + the framework resolver are mocked.

vi.mock('@cio/db/queries/comms', () => ({
  listNotificationPreferences: vi.fn(async () => []),
  upsertNotificationPreference: vi.fn(async () => ({}))
}));
vi.mock('@api/services/comms/notify', () => ({ getCategoryEmailEnabled: vi.fn() }));

import { listNotificationPreferences, upsertNotificationPreference } from '@cio/db/queries/comms';
import { getCategoryEmailEnabled } from '@api/services/comms/notify';
import { getMyPreferences, setMyPreference } from '@api/services/comms/preferences';

const mList = vi.mocked(listNotificationPreferences);
const mUpsert = vi.mocked(upsertNotificationPreference);
const mResolve = vi.mocked(getCategoryEmailEnabled);

const learner: Actor = { authenticated: true, userId: 'me', role: 'LEARNER', status: 'ACTIVE', orgId: 'o1' } as Actor;
const anon: Actor = { authenticated: false } as Actor;

async function code(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 0;
  } catch (e) {
    return (e as { statusCode?: number })?.statusCode ?? -1;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mList.mockResolvedValue([] as never);
  // config defaults via the ONE resolver: coursework/messaging true, announcement/session false.
  mResolve.mockImplementation(async (_u, cat) => cat === 'coursework' || cat === 'messaging');
});

describe('getMyPreferences — effective values via the single resolver', () => {
  it('returns all categories with the resolver value and isDefault when no row', async () => {
    const items = await getMyPreferences(learner);
    expect(items.map((i) => i.category).sort()).toEqual([
      'announcement',
      'coursework',
      'messaging',
      'registration',
      'session'
    ]);
    // resolution came from getCategoryEmailEnabled for the ACTOR
    expect(mResolve).toHaveBeenCalledWith('me', 'coursework');
    const byCat = Object.fromEntries(items.map((i) => [i.category, i]));
    expect(byCat.coursework.emailEnabled).toBe(true);
    expect(byCat.announcement.emailEnabled).toBe(false);
    expect(byCat.session.isDefault).toBe(true); // no saved row
  });

  it('a saved row → isDefault false (value still from the resolver)', async () => {
    mList.mockResolvedValue([{ category: 'messaging', emailEnabled: false }] as never);
    mResolve.mockImplementation(async (_u, cat) => (cat === 'messaging' ? false : cat === 'coursework'));
    const items = await getMyPreferences(learner);
    const messaging = items.find((i) => i.category === 'messaging')!;
    expect(messaging.isDefault).toBe(false);
    expect(messaging.emailEnabled).toBe(false);
  });

  it('anon refused (401)', async () => {
    expect(await code(getMyPreferences(anon))).toBe(401);
  });
});

describe('setMyPreference — self-only write', () => {
  it('upserts the ACTOR own row for a valid category', async () => {
    mResolve.mockResolvedValue(false);
    const res = await setMyPreference(learner, 'messaging', false);
    expect(mUpsert).toHaveBeenCalledWith('me', 'messaging', false);
    expect(res).toMatchObject({ category: 'messaging', emailEnabled: false, isDefault: false });
  });
  it('an unknown category → 400 (no write)', async () => {
    expect(await code(setMyPreference(learner, 'nope', true))).toBe(400);
    expect(mUpsert).not.toHaveBeenCalled();
  });
  it('anon refused (401)', async () => {
    expect(await code(setMyPreference(anon, 'messaging', true))).toBe(401);
  });
});
