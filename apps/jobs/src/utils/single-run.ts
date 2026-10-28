import { randomUUID } from 'node:crypto';

// Redis single-run guard for scans that must never overlap (two compliance scans racing on the same status updates).
// SET NX PX acquires; release only deletes the lock when it still holds OUR token, so a run that overran its TTL
// cannot remove a lock another run has since taken.

export interface LockClient {
  set(key: string, value: string, mode: 'PX', ttlMs: number, flag: 'NX'): Promise<'OK' | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

const RELEASE_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

export async function withSingleRunLock<T>(
  client: LockClient,
  key: string,
  ttlMs: number,
  run: () => Promise<T>
): Promise<{ ran: true; result: T } | { ran: false }> {
  const token = randomUUID();
  const acquired = await client.set(key, token, 'PX', ttlMs, 'NX');
  if (acquired !== 'OK') {
    return { ran: false };
  }

  try {
    return { ran: true, result: await run() };
  } finally {
    try {
      await client.eval(RELEASE_SCRIPT, 1, key, token);
    } catch {
      // The TTL releases it anyway.
    }
  }
}
