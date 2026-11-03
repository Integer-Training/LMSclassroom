export type AccountFetchOutcome<T> =
  | { kind: 'ok'; result: T }
  | { kind: 'unauthenticated'; detail: string }
  | { kind: 'error'; detail: string };

/** Backoff (ms) between /account retries after a network error or 5xx; 2 retries, then give up without signing out. */
export const ACCOUNT_RETRY_DELAYS_MS = [1_000, 3_000];

type RawAccountResponse = { status: number; body: { success?: boolean; code?: string } | null | undefined };

/**
 * Loads /account, retrying transient failures. Only a definite auth rejection (HTTP 401, or a 404 for a
 * deleted account) is reported as 'unauthenticated' — the sole case where the caller should sign the learner out.
 * Network errors and 5xx are retried, then reported as 'error' so the session is kept.
 */
export async function fetchAccountWithRetry<T extends { success: true }>(
  fetchOnce: () => Promise<RawAccountResponse>,
  delays: number[] = ACCOUNT_RETRY_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<AccountFetchOutcome<T>> {
  let detail = 'Error fetching account';

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const { status, body } = await fetchOnce();

      if (body?.success) return { kind: 'ok', result: body as unknown as T };

      detail = JSON.stringify(body ?? { status });
      if (status === 401 || status === 404) return { kind: 'unauthenticated', detail };
    } catch (error) {
      console.error('Error fetching account:', error);
      detail = error instanceof Error ? error.message : 'Error fetching account';
    }

    if (attempt < delays.length) await sleep(delays[attempt]);
  }

  return { kind: 'error', detail };
}
