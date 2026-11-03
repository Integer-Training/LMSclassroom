import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLoginThrottle, isLoginFailureStatus } from '../../../../../packages/db/src/auth/login-throttle';
import { fetchAccountWithRetry } from '../../../../dashboard/src/lib/features/app/account-fetch';
import { createNewsfeedService } from '@api/services/newsfeed/newsfeed';

const enqueue = vi.fn(async () => undefined);
const getNewsfeedForEmail = vi.fn();

vi.mock('@api/services/jobs', () => ({ enqueueTransactionalEmail: (...a: unknown[]) => enqueue(...(a as [])) }));
vi.mock('@cio/db/queries/newsfeed', () => ({
  createNewsfeed: vi.fn(async () => ({ id: 'feed-1' })),
  createNewsfeedComment: vi.fn(),
  deleteNewsfeed: vi.fn(),
  deleteNewsfeedComment: vi.fn(),
  getNewsfeedByCourseId: vi.fn(),
  getNewsfeedByCourseIdPaginated: vi.fn(),
  getNewsfeedById: vi.fn(),
  getNewsfeedCommentById: vi.fn(),
  getNewsfeedCommentsByFeedId: vi.fn(),
  getNewsfeedCommentsByFeedIdPaginated: vi.fn(),
  getNewsfeedForEmail: (...a: unknown[]) => getNewsfeedForEmail(...a),
  updateNewsfeed: vi.fn(),
  updateNewsfeedComment: vi.fn()
}));
vi.mock('@cio/email', () => ({ buildEmailFromName: (n: string) => n, buildEmailBranding: () => ({}) }));
vi.mock('@cio/core/config/dashboard-url', () => ({
  getDashboardBaseUrl: (org?: { customDomain?: string; isCustomDomainVerified?: boolean }) =>
    org?.customDomain && org.isCustomDomainVerified ? `https://${org.customDomain}` : 'https://learn.epearlacademy.com'
}));

describe('sign-in throttle counts failures only', () => {
  it('blocks the IP after max failures and reports retry seconds', () => {
    let t = 0;
    const th = createLoginThrottle({ max: 3, windowMs: 900_000 }, () => t);
    for (let i = 0; i < 3; i++) {
      expect(th.check('1.1.1.1')).toBeNull();
      th.recordFailure('1.1.1.1');
    }
    expect(th.check('1.1.1.1')).toBe(900);
    expect(th.check('2.2.2.2')).toBeNull();
    t = 899_000;
    expect(th.check('1.1.1.1')).toBe(1);
    t = 900_000;
    expect(th.check('1.1.1.1')).toBeNull();
  });

  it('never blocks when nothing is recorded (successful sign-ins are not recorded)', () => {
    const th = createLoginThrottle({ max: 3, windowMs: 1000 });
    for (let i = 0; i < 100; i++) expect(th.check('ip')).toBeNull();
  });

  it('only 401/403 count as failures', () => {
    expect([200, 401, 403, 429, 500].map(isLoginFailureStatus)).toEqual([false, true, true, false, false]);
  });
});

describe('fetchAccountWithRetry only signs out on a definite auth rejection', () => {
  const sleep = vi.fn(async () => undefined);
  beforeEach(() => sleep.mockClear());

  it('401 is unauthenticated immediately, no retry', async () => {
    const f = vi.fn(async () => ({ status: 401, body: { success: false } }));
    const r = await fetchAccountWithRetry(f, [1, 2], sleep);
    expect(r.kind).toBe('unauthenticated');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('5xx and network errors retry twice then give up as error (no logout)', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce({ status: 500, body: { success: false } })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ status: 503, body: null });
    const r = await fetchAccountWithRetry(f, [1, 2], sleep);
    expect(r.kind).toBe('error');
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('recovers when a retry succeeds', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce({ status: 502, body: null })
      .mockResolvedValueOnce({ status: 200, body: { success: true } });
    const r = await fetchAccountWithRetry(f, [1, 2], sleep);
    expect(r.kind).toBe('ok');
  });
});

describe('newsfeed email links use the configured dashboard URL', () => {
  beforeEach(() => {
    enqueue.mockClear();
    getNewsfeedForEmail.mockResolvedValue({
      feedId: 'feed-1',
      courseId: 'course-1',
      courseTitle: 'C',
      content: 'x',
      author: { email: 'a@b.c', fullname: 'A', groupMemberId: 'g' },
      organization: { id: 'o', name: 'Org', siteName: 'pearl', customDomain: null, isCustomDomainVerified: false },
      courseMembers: [{ email: 'l@b.c', fullname: 'L' }]
    });
  });

  it('post email does not point at myclassroomio.com', { timeout: 60_000 }, async () => {
    await createNewsfeedService('course-1', 'g', { content: 'hi' } as never);
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalled());
    const [, payload] = enqueue.mock.calls[0] as unknown as [string, { fields: { postLink: string } }];
    expect(payload.fields.postLink).toBe('https://learn.epearlacademy.com/courses/course-1?feedId=feed-1');
    expect(payload.fields.postLink).not.toContain('myclassroomio');
  });
});
