/**
 * Races a promise against a timeout. If `ms` elapses first, rejects with a `TimeoutError`; otherwise resolves
 * (or rejects) with the original promise. The loser's late settlement is swallowed so it can never surface as an
 * unhandled rejection. Used to bound I/O (Redis, DB) that must never hang a request indefinitely.
 */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });

  // If the real work loses the race and settles later, make sure its rejection is not left unhandled.
  promise.catch(() => {});

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
