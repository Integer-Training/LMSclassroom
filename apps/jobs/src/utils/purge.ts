// Batched, throttled retention purges. A purge loops `deleteBatch` (each call removes at most `batchSize` rows) until a
// batch comes back short, pausing between batches so it never monopolises the shared DB pool, and stops at a batch
// or time ceiling so one run can never go on indefinitely. Dependency-free so it is unit-testable.

export interface BatchedPurgeOptions {
  batchSize: number;
  /** Safety ceiling: stop after this many batches even if rows remain (the next daily run continues). */
  maxBatches: number;
  /** Safety ceiling on wall-clock time for this purge. */
  maxDurationMs: number;
  /** Pause between full batches (keeps the pool free for request traffic). */
  pauseMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface BatchedPurgeResult {
  deleted: number;
  batches: number;
  /** True when a ceiling stopped the purge while rows may remain. */
  truncated: boolean;
}

export const DEFAULT_PURGE_OPTIONS: BatchedPurgeOptions = {
  batchSize: 5_000,
  maxBatches: 200,
  maxDurationMs: 15 * 60_000,
  pauseMs: 250
};

export async function runBatchedPurge(
  deleteBatch: (batchSize: number) => Promise<number>,
  options: Partial<BatchedPurgeOptions> = {}
): Promise<BatchedPurgeResult> {
  const opts = { ...DEFAULT_PURGE_OPTIONS, ...options };
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? Date.now;
  const startedAt = now();

  let deleted = 0;
  let batches = 0;

  while (batches < opts.maxBatches) {
    const removed = await deleteBatch(opts.batchSize);
    batches += 1;
    deleted += removed;

    if (removed < opts.batchSize) {
      return { deleted, batches, truncated: false };
    }

    if (now() - startedAt >= opts.maxDurationMs) {
      return { deleted, batches, truncated: true };
    }

    await sleep(opts.pauseMs);
  }

  return { deleted, batches, truncated: true };
}

/** Env flag helper: unset/empty => `defaultOn`; "false", "0", "off", "no" disable; anything else enables. */
export function isFlagEnabled(raw: string | undefined, defaultOn: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return defaultOn;

  return !['false', '0', 'off', 'no'].includes(raw.trim().toLowerCase());
}
