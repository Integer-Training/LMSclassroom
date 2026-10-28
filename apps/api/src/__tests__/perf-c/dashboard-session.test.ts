import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NEGATIVE_MEMO_MAX_MS,
  clearSessionMemo,
  evictSessionMemo,
  resolveMemoTtlMs,
  resolveSessionState,
  type SessionFetcher
} from '../../../../dashboard/src/lib/utils/services/auth/session-core';
import { sessionUnavailableResponse } from '../../../../dashboard/src/lib/utils/session-unavailable';

// PearlLMS scalability Phase C3 — the dashboard's SSR session lookup is tri-state (session | none | error) with a
// bounded timeout, so an API blip renders a retry page instead of bouncing a signed-in user to /login. The
// dashboard has no wired test runner, so its pure modules are exercised here (same pattern as no-leaky-logs).

const SESSION_JSON = {
  user: { id: 'u1', email: 'a@b.test', name: 'A' },
  session: { id: 's1', token: 'secret', ipAddress: '1.2.3.4', userAgent: 'ua' },
  orgRoles: { o1: 1 },
  status: 'ACTIVE'
};

const ok =
  (data: unknown): SessionFetcher =>
  async () => ({ ok: true, data });

beforeEach(() => {
  clearSessionMemo();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveSessionState — tri-state', () => {
  it('no cookies -> none without calling the API', async () => {
    const fetcher = vi.fn(ok(SESSION_JSON));
    expect(await resolveSessionState('', fetcher)).toEqual({ status: 'none' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('session: keeps the get-session JSON shape identical and adds fromSessions + actor', async () => {
    const state = await resolveSessionState('c=1', ok(structuredClone(SESSION_JSON)));

    expect(state.status).toBe('session');
    if (state.status !== 'session') return;

    expect(state.locals.user).toEqual(SESSION_JSON.user);
    expect(state.locals.session).toEqual(SESSION_JSON.session);
    expect(state.locals.orgRoles).toEqual({ o1: 1 });
    expect(state.locals.status).toBe('ACTIVE');
    expect(state.locals.fromSessions).toBe(true);
    expect(state.locals.actor).toMatchObject({ authenticated: true, userId: 'u1', role: 'ADMIN', orgId: 'o1' });
  });

  it('a deactivated status in the session yields a denied actor', async () => {
    const state = await resolveSessionState('c=1', ok({ ...SESSION_JSON, status: 'DEACTIVATED' }));
    expect(state.status === 'session' && state.locals.actor?.authenticated).toBe(false);
  });

  it('API answered with no session (null body) -> none', async () => {
    expect(await resolveSessionState('c=1', ok(null))).toEqual({ status: 'none' });
  });

  it('API unreachable / 5xx (fetcher reports failure) -> error, NOT none', async () => {
    expect(await resolveSessionState('c=1', async () => ({ ok: false }))).toEqual({ status: 'error' });
  });

  it('a throwing fetcher -> error', async () => {
    const throwing: SessionFetcher = async () => {
      throw new Error('ECONNREFUSED');
    };
    expect(await resolveSessionState('c=1', throwing)).toEqual({ status: 'error' });
  });

  it('a hung get-session times out -> error (user sees the retry page, not /login) and aborts the request', async () => {
    let aborted = false;
    const hang: SessionFetcher = (_cookie, signal) =>
      new Promise(() => {
        signal.addEventListener('abort', () => {
          aborted = true;
        });
      });

    const state = await resolveSessionState('c=1', hang, { timeoutMs: 20 });

    expect(state).toEqual({ status: 'error' });
    expect(aborted).toBe(true);
  });
});

describe('single-flight and (opt-in) memo', () => {
  it('concurrent identical lookups share one API call', async () => {
    const fetcher = vi.fn(ok(structuredClone(SESSION_JSON)));
    await Promise.all([resolveSessionState('c=1', fetcher), resolveSessionState('c=1', fetcher)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('different cookies never share a result', async () => {
    const fetcher = vi.fn(ok(structuredClone(SESSION_JSON)));
    await Promise.all([resolveSessionState('c=1', fetcher), resolveSessionState('c=2', fetcher)]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('the cross-request memo is OFF by default: deactivation applies on the very next request', async () => {
    const fetcher = vi
      .fn<SessionFetcher>()
      .mockResolvedValueOnce({ ok: true, data: structuredClone(SESSION_JSON) })
      .mockResolvedValueOnce({ ok: true, data: { ...structuredClone(SESSION_JSON), status: 'DEACTIVATED' } });

    const first = await resolveSessionState('c=1', fetcher);
    const second = await resolveSessionState('c=1', fetcher);

    expect(first.status === 'session' && first.locals.actor?.authenticated).toBe(true);
    expect(second.status === 'session' && second.locals.actor?.authenticated).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('SSR_SESSION_MEMO_TTL_MS parsing: unset/invalid -> 0 (off), clamped to 5s', () => {
    expect(resolveMemoTtlMs(undefined)).toBe(0);
    expect(resolveMemoTtlMs('')).toBe(0);
    expect(resolveMemoTtlMs('abc')).toBe(0);
    expect(resolveMemoTtlMs('-1')).toBe(0);
    expect(resolveMemoTtlMs('3000')).toBe(3000);
    expect(resolveMemoTtlMs('60000')).toBe(5000);
  });

  it('when enabled: a session is memoised, none/error for at most 1s, and eviction drops it (sign-out)', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(ok(structuredClone(SESSION_JSON)));

    await resolveSessionState('c=1', fetcher, { memoTtlMs: 3000 });
    await resolveSessionState('c=1', fetcher, { memoTtlMs: 3000 });
    expect(fetcher).toHaveBeenCalledTimes(1);

    evictSessionMemo('c=1');
    await resolveSessionState('c=1', fetcher, { memoTtlMs: 3000 });
    expect(fetcher).toHaveBeenCalledTimes(2);

    const failing = vi.fn<SessionFetcher>(async () => ({ ok: false }));
    await resolveSessionState('c=err', failing, { memoTtlMs: 5000 });
    await resolveSessionState('c=err', failing, { memoTtlMs: 5000 });
    expect(failing).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(NEGATIVE_MEMO_MAX_MS + 50);
    await resolveSessionState('c=err', failing, { memoTtlMs: 5000 });
    expect(failing).toHaveBeenCalledTimes(2);
  });
});

describe('sessionUnavailableResponse (error state is never a redirect)', () => {
  it('page: 503 + Retry-After, HTML with an auto-retry, no Location, no script', async () => {
    const res = sessionUnavailableResponse('page');
    const body = await res.text();

    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(res.headers.get('Location')).toBeNull();
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(body).toContain('http-equiv="refresh"');
    expect(body).not.toContain('<script');
  });

  it('api: 503 JSON, never a redirect to /login', async () => {
    const res = sessionUnavailableResponse('api');

    expect(res.status).toBe(503);
    expect(res.headers.get('Location')).toBeNull();
    expect((await res.json()).code).toBe('SERVICE_UNAVAILABLE');
  });
});
