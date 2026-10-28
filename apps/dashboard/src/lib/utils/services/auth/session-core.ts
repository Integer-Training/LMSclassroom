import { createHash } from 'node:crypto';
import { TtlCache } from '@cio/utils/cache';
import { getActor } from './actor';

// PearlLMS scalability Phase C3 — the SSR session lookup, as a pure (dependency-injected) core so it is unit
// testable without SvelteKit. session.ts wires it to the real better-auth client.
//
// Tri-state result:
//   session — a live session (locals built from the get-session JSON, unchanged shape)
//   none    — the API answered and there is no (valid) session  => callers may send the user to /login
//   error   — the API could not be reached / timed out / answered 5xx => callers must NOT treat this as logged out
//             (render a retry page); redirecting to /login would loop because the login page calls get-session too.

export type SessionState = { status: 'session'; locals: App.Locals } | { status: 'none' } | { status: 'error' };

/** What the injected fetcher reports. `data: null` means "API answered, no session". */
export type SessionFetchResult = { ok: true; data: unknown | null } | { ok: false };

export type SessionFetcher = (cookieString: string, signal: AbortSignal) => Promise<SessionFetchResult>;

export const SESSION_FETCH_TIMEOUT_MS = 4000;
/** `none` / `error` results are never memoised longer than this, even when the memo is on. */
export const NEGATIVE_MEMO_MAX_MS = 1000;
const MEMO_TTL_CEILING_MS = 5000;
const MEMO_MAX_ENTRIES = 5000;

const memo = new TtlCache<SessionState>({ maxEntries: MEMO_MAX_ENTRIES });
const inflight = new Map<string, Promise<SessionState>>();

/** sha256 of the cookie string — the memo never keeps the raw session cookie around. */
export function sessionCacheKey(cookieString: string): string {
  return createHash('sha256').update(cookieString).digest('hex');
}

/** Forget a cookie's memoised session (sign-in / sign-out passing through the proxy). */
export function evictSessionMemo(cookieString: string): void {
  if (!cookieString) return;

  memo.delete(sessionCacheKey(cookieString));
}

/** Test/ops helper. */
export function clearSessionMemo(): void {
  memo.clear();
  inflight.clear();
}

/**
 * Parse SSR_SESSION_MEMO_TTL_MS. The cross-request memo caches role/status for the dashboard's UI actor, so it is
 * OFF by default (0): docs/ACCESS.md §8 wants deactivation and role changes to apply on the very next request. The API
 * re-resolves the Actor on every call regardless. When enabled it is clamped to 5s.
 */
export function resolveMemoTtlMs(raw: string | undefined | null): number {
  if (raw === undefined || raw === null || raw.trim() === '') return 0;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;

  return Math.min(Math.floor(parsed), MEMO_TTL_CEILING_MS);
}

function toState(result: SessionFetchResult): SessionState {
  if (!result.ok) return { status: 'error' };
  if (!result.data) return { status: 'none' };

  const locals = result.data as App.Locals;
  // A get-session body without a user is not a session.
  if (!locals.user) return { status: 'none' };

  // This will always be true because if we don't have classroomio cookies, we won't reach this line of code.
  locals.fromSessions = true;
  // Single session -> Actor path (role + status). Deny-by-default consumers read locals.actor.
  locals.actor = getActor(locals as unknown as Parameters<typeof getActor>[0]);

  return { status: 'session', locals };
}

async function fetchWithTimeout(
  fetcher: SessionFetcher,
  cookieString: string,
  timeoutMs: number
): Promise<SessionFetchResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<SessionFetchResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false });
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      fetcher(cookieString, controller.signal).catch(() => ({ ok: false as const })),
      timeout
    ]);
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

export interface ResolveSessionOptions {
  timeoutMs?: number;
  memoTtlMs?: number;
}

/**
 * Resolve the session for a cookie string. Concurrent identical lookups share one request (single-flight). Results
 * are memoised only when `memoTtlMs` > 0 (default off), `none`/`error` for at most 1s.
 */
export async function resolveSessionState(
  cookieString: string,
  fetcher: SessionFetcher,
  options: ResolveSessionOptions = {}
): Promise<SessionState> {
  if (!cookieString) return { status: 'none' };

  const timeoutMs = options.timeoutMs ?? SESSION_FETCH_TIMEOUT_MS;
  const memoTtlMs = options.memoTtlMs ?? 0;
  const key = sessionCacheKey(cookieString);

  if (memoTtlMs > 0) {
    const hit = memo.get(key);
    if (hit) return hit;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise: Promise<SessionState> = fetchWithTimeout(fetcher, cookieString, timeoutMs)
    .then((result) => {
      const state = toState(result);
      if (memoTtlMs > 0) {
        memo.set(key, state, state.status === 'session' ? memoTtlMs : Math.min(memoTtlMs, NEGATIVE_MEMO_MAX_MS));
      }

      return state;
    })
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });

  inflight.set(key, promise);

  return promise;
}
