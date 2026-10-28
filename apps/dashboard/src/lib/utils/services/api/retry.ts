// Retry policy for the dashboard API client. Kept free of SvelteKit imports so it can be unit-tested directly.

/** Only idempotent reads are safe to repeat blindly; a retried POST/PUT/PATCH/DELETE can double-apply. */
export function isIdempotentMethod(method: string | undefined | null): boolean {
  const m = (method ?? 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD';
}

/** Gateway-style statuses a deploy/restart produces; a plain 500 is a real server error and is not retried. */
export function isRetryableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

/** Exponential backoff with +/-25% jitter so many clients retrying after a deploy don't stampede together. */
export function retryDelayMs(baseMs: number, attempt: number, random: () => number = Math.random): number {
  const exp = baseMs * Math.pow(2, attempt);
  return Math.round(exp * (0.75 + random() * 0.5));
}
