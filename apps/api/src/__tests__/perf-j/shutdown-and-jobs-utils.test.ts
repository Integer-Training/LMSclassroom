import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Phase J (no-graceful-shutdown, worker-shutdown-and-limits, maintenance, rollup) — the API drains in-flight requests
// before releasing connections; the jobs process has ONE coordinated shutdown (no worker's idle exit kills another's
// running job); purges are batched/throttled; compliance scans are single-run guarded; ffmpeg is bounded.

// SAFETY: the jobs modules import the data layer; pin an unreachable URL BEFORE anything is imported.
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
  process.env.PRIVATE_DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
});

import { createShutdownHandler, resolveShutdownTimeoutMs } from '@api/shutdown';
import { clearShutdownTasks, createShutdown, registerShutdownTask } from '../../../../jobs/src/utils/shutdown';
import { isFlagEnabled, runBatchedPurge, DEFAULT_PURGE_OPTIONS } from '../../../../jobs/src/utils/purge';
import { withSingleRunLock } from '../../../../jobs/src/utils/single-run';
import { ffmpegTimeoutMs, killActiveFfmpegProcesses, withSingleThread } from '../../../../jobs/src/utils/ffmpeg';
import { computeCatchUpDays, ROLLUP_MAX_CATCH_UP_DAYS } from '@cio/analytics';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('API graceful shutdown', () => {
  const makeServer = () => {
    let closeCb: (() => void) | undefined;
    return {
      close: vi.fn((cb?: () => void) => {
        closeCb = cb;
      }),
      closeIdleConnections: vi.fn(),
      closeAllConnections: vi.fn(),
      finish: () => closeCb?.()
    };
  };

  it('stops accepting, waits for in-flight requests, THEN releases connections and exits 0', async () => {
    const order: string[] = [];
    const server = makeServer();
    const exit = vi.fn();
    const shutdown = createShutdownHandler({
      server,
      timeoutMs: 25_000,
      exit,
      log: () => {},
      cleanup: [
        { name: 'queues', run: async () => order.push('queues') },
        { name: 'db', run: async () => order.push('db') }
      ]
    });

    const done = shutdown('SIGTERM');
    await Promise.resolve();
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.closeIdleConnections).toHaveBeenCalled();
    expect(order).toEqual([]); // request still in flight: nothing released yet
    expect(exit).not.toHaveBeenCalled();

    server.finish();
    await done;

    expect(order.sort()).toEqual(['db', 'queues']);
    expect(exit).toHaveBeenCalledWith(0);
    expect(server.closeAllConnections).not.toHaveBeenCalled();
  });

  it('after the deadline it cuts the remaining connections and still cleans up', async () => {
    vi.useFakeTimers();
    const server = makeServer();
    const exit = vi.fn();
    const cleanup = vi.fn(async () => undefined);
    const shutdown = createShutdownHandler({
      server,
      timeoutMs: 25_000,
      exit,
      log: () => {},
      cleanup: [{ name: 'db', run: cleanup }]
    });

    const done = shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(25_001);
    await done;

    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('a failing cleanup step never blocks the others or the exit, and a second signal is a no-op', async () => {
    const server = makeServer();
    const exit = vi.fn();
    const ok = vi.fn(async () => undefined);
    const shutdown = createShutdownHandler({
      server,
      timeoutMs: 1_000,
      exit,
      log: () => {},
      cleanup: [
        {
          name: 'redis',
          run: async () => {
            throw new Error('redis gone');
          }
        },
        { name: 'db', run: ok }
      ]
    });

    const first = shutdown('SIGTERM');
    const second = shutdown('SIGINT');
    server.finish();
    await Promise.all([first, second]);

    expect(ok).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it('SHUTDOWN_TIMEOUT is seconds, default 25', () => {
    expect(resolveShutdownTimeoutMs(undefined)).toBe(25_000);
    expect(resolveShutdownTimeoutMs('40')).toBe(40_000);
    expect(resolveShutdownTimeoutMs('nonsense')).toBe(25_000);
  });
});

describe('jobs coordinated shutdown', () => {
  beforeEach(() => clearShutdownTasks());

  const make = (over: Partial<Parameters<typeof createShutdown>[0]> = {}) => {
    const exit = vi.fn();
    const afterWorkers = vi.fn(async () => undefined);
    const killChildren = vi.fn(() => 0);
    const shutdown = createShutdown({
      timeoutMs: 270_000,
      killChildren,
      afterWorkers,
      exit,
      log: () => {},
      ...over
    });
    return { shutdown, exit, afterWorkers, killChildren };
  };

  it('does not exit while ANY worker is still finishing (an idle worker no longer kills a running job)', async () => {
    vi.useFakeTimers();
    let releaseMedia!: () => void;
    registerShutdownTask('emails', async () => undefined); // idle: closes at once
    registerShutdownTask('media', () => new Promise<void>((resolve) => (releaseMedia = resolve))); // ffmpeg running
    const { shutdown, exit, afterWorkers } = make();

    const done = shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(exit).not.toHaveBeenCalled();
    expect(afterWorkers).not.toHaveBeenCalled();

    releaseMedia();
    await done;

    expect(afterWorkers).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('after the grace period it kills ffmpeg children, force-closes the workers and exits', async () => {
    vi.useFakeTimers();
    const closes: boolean[] = [];
    registerShutdownTask('media', (force) => {
      closes.push(force);
      return force ? Promise.resolve() : new Promise<void>(() => {});
    });
    const { shutdown, exit, killChildren } = make({ timeoutMs: 1_000 });

    const done = shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(1_001);
    await done;

    expect(closes).toEqual([false, true]);
    expect(killChildren).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('a worker whose close throws does not stop the rest', async () => {
    const closed = vi.fn(async () => undefined);
    registerShutdownTask('a', async () => {
      throw new Error('quit failed');
    });
    registerShutdownTask('b', closed);
    const { shutdown, exit } = make();

    await shutdown('SIGTERM');

    expect(closed).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe('batched purge runner', () => {
  const opts = { batchSize: 100, maxBatches: 10, maxDurationMs: 60_000, pauseMs: 5, sleep: async () => undefined };

  it('loops until a short batch, summing what was deleted', async () => {
    const batches = [100, 100, 37];
    const deleteBatch = vi.fn(async () => batches.shift() ?? 0);

    const out = await runBatchedPurge(deleteBatch, opts);

    expect(out).toEqual({ deleted: 237, batches: 3, truncated: false });
    expect(deleteBatch).toHaveBeenCalledWith(100);
  });

  it('pauses between full batches (throttle) and not after the last', async () => {
    const sleep = vi.fn(async () => undefined);
    const batches = [100, 100, 0];

    await runBatchedPurge(async () => batches.shift() ?? 0, { ...opts, sleep });

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5);
  });

  it('stops at the batch ceiling and reports truncated', async () => {
    const deleteBatch = vi.fn(async () => 100);

    const out = await runBatchedPurge(deleteBatch, { ...opts, maxBatches: 4 });

    expect(out).toEqual({ deleted: 400, batches: 4, truncated: true });
  });

  it('stops at the time ceiling', async () => {
    let t = 0;
    const out = await runBatchedPurge(async () => 100, {
      ...opts,
      maxDurationMs: 1_000,
      now: () => (t += 600)
    });

    expect(out.truncated).toBe(true);
    expect(out.batches).toBeLessThan(10);
  });

  it('defaults to 5k per batch', () => {
    expect(DEFAULT_PURGE_OPTIONS.batchSize).toBe(5_000);
  });

  it('env flags: unset uses the default, false/0/off/no disable', () => {
    expect(isFlagEnabled(undefined, true)).toBe(true);
    expect(isFlagEnabled('', false)).toBe(false);
    expect(isFlagEnabled('false', true)).toBe(false);
    expect(isFlagEnabled('0', true)).toBe(false);
    expect(isFlagEnabled('OFF', true)).toBe(false);
    expect(isFlagEnabled('true', false)).toBe(true);
  });
});

describe('single-run lock', () => {
  const makeClient = () => {
    const store = new Map<string, string>();
    return {
      store,
      client: {
        set: vi.fn(async (key: string, value: string, _mode: 'PX', _ttl: number, _flag: 'NX') => {
          if (store.has(key)) return null;
          store.set(key, value);
          return 'OK' as const;
        }),
        eval: vi.fn(async (_script: string, _n: number, key: string, token: string) => {
          if (store.get(key) === token) store.delete(key);
          return 1;
        })
      }
    };
  };

  it('runs once, releases afterwards, and a concurrent run is refused', async () => {
    const { client, store } = makeClient();
    let inner: Awaited<ReturnType<typeof withSingleRunLock>> | undefined;

    const outer = await withSingleRunLock(client, 'lock:scan', 60_000, async () => {
      inner = await withSingleRunLock(client, 'lock:scan', 60_000, async () => 'second');
      return 'first';
    });

    expect(outer).toEqual({ ran: true, result: 'first' });
    expect(inner).toEqual({ ran: false });
    expect(store.size).toBe(0); // released

    expect(await withSingleRunLock(client, 'lock:scan', 60_000, async () => 'again')).toEqual({
      ran: true,
      result: 'again'
    });
  });

  it('releases the lock even when the scan throws', async () => {
    const { client, store } = makeClient();

    await expect(
      withSingleRunLock(client, 'lock:scan', 60_000, async () => {
        throw new Error('scan failed');
      })
    ).rejects.toThrow('scan failed');
    expect(store.size).toBe(0);
  });
});

describe('ffmpeg limits', () => {
  it('timeout is 30 min, +10 min per GiB of input, capped at 60 min; FFMPEG_TIMEOUT_MS overrides', () => {
    const GiB = 1024 ** 3;
    expect(ffmpegTimeoutMs()).toBe(30 * 60_000);
    expect(ffmpegTimeoutMs(1 * GiB)).toBe(40 * 60_000);
    expect(ffmpegTimeoutMs(20 * GiB)).toBe(60 * 60_000);

    vi.stubEnv('FFMPEG_TIMEOUT_MS', '120000');
    expect(ffmpegTimeoutMs(20 * GiB)).toBe(120_000);
  });

  it('adds -threads 1 for the decoder (before -i) and the encoder (before the output file)', () => {
    expect(withSingleThread(['-y', '-i', 'in.mp4', '-vn', 'out.mp3'])).toEqual([
      '-y',
      '-threads',
      '1',
      '-i',
      'in.mp4',
      '-vn',
      '-threads',
      '1',
      'out.mp3'
    ]);
  });

  it('leaves argv without an input untouched and has nothing to kill when idle', () => {
    expect(withSingleThread(['-version'])).toEqual(['-version']);
    expect(killActiveFfmpegProcesses()).toBe(0);
  });
});

describe('analytics rollup catch-up', () => {
  const now = new Date('2026-10-28T00:15:00Z');

  it('rolls just yesterday when up to date or never rolled up', () => {
    expect(computeCatchUpDays('2026-10-27', now)).toBe(1);
    expect(computeCatchUpDays(null, now)).toBe(1);
  });

  it('covers every day missed since the last rollup', () => {
    expect(computeCatchUpDays('2026-10-24', now)).toBe(3); // 25, 26, 27
  });

  it('is bounded to 14 days however long the outage was', () => {
    expect(computeCatchUpDays('2026-01-01', now)).toBe(ROLLUP_MAX_CATCH_UP_DAYS);
    expect(ROLLUP_MAX_CATCH_UP_DAYS).toBe(14);
  });
});
