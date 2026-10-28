/**
 * Run `fn` over `items` with at most `limit` in flight at once (default 4), preserving result order. A tiny stand-in
 * for an unbounded `Promise.all(items.map(fn))` fan-out, so one request cannot take every pooled DB connection.
 * Rejects (and stops starting new work) on the first error, like Promise.all.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(workers);
  return results;
}
