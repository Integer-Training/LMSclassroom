import { describe, expect, it, vi } from 'vitest';
import { TtlCache, parseTtlMs } from '@cio/utils/cache';

// PearlLMS scalability Phase C — the shared TTL cache + single-flight primitive behind the org / OG / course-org caches.

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

describe('TtlCache', () => {
  it('returns a value until its TTL expires, then misses', () => {
    let now = 1000;
    const cache = new TtlCache<string>({ now: () => now });
    cache.set('a', 'x', 100);

    expect(cache.get('a')).toBe('x');
    now += 99;
    expect(cache.get('a')).toBe('x');
    now += 2;
    expect(cache.get('a')).toBeUndefined();
  });

  it('ttl <= 0 stores nothing (kill switch)', () => {
    const cache = new TtlCache<string>();
    cache.set('a', 'x', 0);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('evicts the least recently used entry past maxEntries', () => {
    const cache = new TtlCache<number>({ maxEntries: 2 });
    cache.set('a', 1, 1000);
    cache.set('b', 2, 1000);
    cache.get('a'); // a is now most recent
    cache.set('c', 3, 1000);

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  it('getOrLoad caches the loaded value and does not call the loader again within the TTL', async () => {
    const cache = new TtlCache<string>();
    const loader = vi.fn(async () => 'v');

    expect(await cache.getOrLoad('k', loader, () => 1000)).toBe('v');
    expect(await cache.getOrLoad('k', loader, () => 1000)).toBe('v');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('getOrLoad is single-flight: concurrent callers share one load', async () => {
    const cache = new TtlCache<string>();
    const d = deferred<string>();
    const loader = vi.fn(() => d.promise);

    const a = cache.getOrLoad('k', loader, () => 0);
    const b = cache.getOrLoad('k', loader, () => 0);
    d.resolve('v');

    expect(await Promise.all([a, b])).toEqual(['v', 'v']);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('with ttl 0 it is pure single-flight: the next sequential call loads again', async () => {
    const cache = new TtlCache<string>();
    const loader = vi.fn(async () => 'v');

    await cache.getOrLoad('k', loader, () => 0);
    await cache.getOrLoad('k', loader, () => 0);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('never caches a loader error (sync or async) and the next caller retries', async () => {
    const cache = new TtlCache<string>();
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementationOnce(() => {
        throw new Error('sync boom');
      })
      .mockResolvedValue('ok');

    await expect(cache.getOrLoad('k', loader, () => 1000)).rejects.toThrow('boom');
    await expect(cache.getOrLoad('k', loader, () => 1000)).rejects.toThrow('sync boom');
    expect(await cache.getOrLoad('k', loader, () => 1000)).toBe('ok');
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('can cache an empty answer for a shorter time via ttlFor', async () => {
    let now = 0;
    const cache = new TtlCache<string | null>({ now: () => now });
    const loader = vi.fn(async () => null);
    const ttlFor = (v: string | null) => (v === null ? 2000 : 60000);

    await cache.getOrLoad('k', loader, ttlFor);
    now += 1999;
    await cache.getOrLoad('k', loader, ttlFor);
    expect(loader).toHaveBeenCalledTimes(1);
    now += 2;
    await cache.getOrLoad('k', loader, ttlFor);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('delete()/clear() during an in-flight load stops that stale result being stored', async () => {
    const cache = new TtlCache<string>();
    const d = deferred<string>();
    const first = cache.getOrLoad(
      'k',
      () => d.promise,
      () => 1000
    );
    cache.clear(); // e.g. the underlying row was just written
    d.resolve('stale');
    expect(await first).toBe('stale');

    const loader = vi.fn(async () => 'fresh');
    expect(await cache.getOrLoad('k', loader, () => 1000)).toBe('fresh');
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe('parseTtlMs', () => {
  it('uses the fallback for unset / blank / invalid values', () => {
    expect(parseTtlMs(undefined, 30)).toBe(30);
    expect(parseTtlMs('', 30)).toBe(30);
    expect(parseTtlMs('abc', 30)).toBe(30);
  });

  it('0 and negatives disable (kill switch)', () => {
    expect(parseTtlMs('0', 30)).toBe(0);
    expect(parseTtlMs('-5', 30)).toBe(0);
  });

  it('parses a positive number of ms', () => {
    expect(parseTtlMs('1500', 30)).toBe(1500);
  });
});
