import type { Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { authServerClient } from './server';
import { classroomio } from '$lib/utils/services/api';
import { getCioCookieString, getHasCioCookies } from '$lib/utils/functions/cookies';
import {
  evictSessionMemo,
  resolveMemoTtlMs,
  resolveSessionState,
  type SessionFetcher,
  type SessionState
} from './session-core';

export type { SessionState };

// Real fetcher: better-auth getSession over the API. A thrown error, an abort/timeout or a 5xx is reported as
// `{ ok: false }` (=> `error`, NOT "logged out"). A 4xx other than 408/429 means the API answered and rejected the
// cookie => `none`. A 200 with a null body is the normal "no session" answer.
const fetchSessionFromApi: SessionFetcher = async (cookieString, signal) => {
  try {
    const session = await authServerClient.getSession({
      fetchOptions: {
        headers: { cookie: cookieString },
        signal
      }
    });

    if (session.error) {
      const status = session.error.status;
      const rejected = typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429;

      return rejected ? { ok: true, data: null } : { ok: false };
    }

    return { ok: true, data: session.data ?? null };
  } catch (error) {
    console.error('Session verification failed:', error instanceof Error ? error.message : error);

    return { ok: false };
  }
};

/** Tri-state session lookup for hooks.server.ts (see session-core.ts). */
export const getSessionState = async (cookies: Cookies): Promise<SessionState> => {
  // Only the locale cookie (or none) => there is no session to look up; skip the API round trip entirely.
  if (!getHasCioCookies(cookies)) return { status: 'none' };

  const cioCookies = getCioCookieString(cookies);

  return resolveSessionState(cioCookies, fetchSessionFromApi, {
    memoTtlMs: resolveMemoTtlMs(env.SSR_SESSION_MEMO_TTL_MS)
  });
};

/** Drop the memoised session for these cookies (called when /api/auth/sign-in or /sign-out passes through). */
export const forgetSession = (cookies: Cookies): void => {
  evictSessionMemo(getCioCookieString(cookies));
};

export async function getThroughTrpc(allCookies: string) {
  const session = await classroomio.session.$get(undefined, {
    headers: {
      cookie: allCookies
    }
  });

  const data = (await session.json()) as App.Locals;

  return data;
}
