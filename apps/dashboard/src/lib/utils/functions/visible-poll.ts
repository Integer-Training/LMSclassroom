// PearlLMS scalability Phase D — one shared, visibility-aware background poller. Replaces the ad-hoc
// `setInterval` pings (heartbeat, notification bell, header context, admin "online now") that kept firing from
// hidden tabs, all in lock-step, and kept hammering a failing API.
//
// - Pauses while the tab is hidden (no timer is armed, so a background tab costs nothing).
// - Runs immediately when the tab becomes visible again (throttled by `minResumeGapMs` so rapid tab flips
//   can't fire a request storm), then carries on at the normal cadence.
// - +-`jitter` (default 20%) on every delay so many tabs/users drift apart instead of polling in lock-step.
// - Backs off exponentially after a failed run (the task returns `false` or throws — e.g. 429/5xx), capped at
//   `maxBackoffMs`, and snaps back to the normal cadence on the next success.
// - Never overlaps itself: a run still in flight is not started again.
//
// The heartbeat must stay at 60s (the server's "online" window is 5 minutes, and touchSession ignores touches
// < 45s apart), so callers choose their own `intervalMs`; jitter keeps 60s within 48-72s.

export interface VisiblePollOptions {
  /** Nominal gap between runs. */
  intervalMs: number;
  /** The work. Resolve/return `false` or throw to signal failure (triggers backoff); anything else is success. */
  task: () => unknown;
  /** Run once right away on start (default true). */
  immediate?: boolean;
  /** Checked before every run; when it returns false the run is skipped (the cadence continues). */
  isEnabled?: () => boolean;
  /** Fractional random spread applied to each delay (default 0.2 => +-20%). */
  jitter?: number;
  /** Upper bound for the backed-off delay (default: 8x the interval, at most 5 minutes). */
  maxBackoffMs?: number;
  /** Skip the on-return refresh if the last run was more recent than this (default 5s). */
  minResumeGapMs?: number;
  /** Injectable for tests. */
  doc?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
  random?: () => number;
  now?: () => number;
}

export interface VisiblePoll {
  start(): void;
  stop(): void;
}

const MAX_BACKOFF_CAP_MS = 5 * 60_000;

/** The delay before the next run: `intervalMs` doubled per consecutive failure (capped), then jittered. */
export function nextPollDelayMs(opts: {
  intervalMs: number;
  failures: number;
  jitter: number;
  maxBackoffMs: number;
  random: number;
}): number {
  const backedOff = Math.min(
    opts.intervalMs * 2 ** Math.max(0, opts.failures),
    Math.max(opts.maxBackoffMs, opts.intervalMs)
  );
  const spread = (opts.random * 2 - 1) * opts.jitter;

  return Math.max(0, Math.round(backedOff * (1 + spread)));
}

export function createVisiblePoll(options: VisiblePollOptions): VisiblePoll {
  const { intervalMs, task } = options;
  const jitter = options.jitter ?? 0.2;
  const maxBackoffMs = options.maxBackoffMs ?? Math.min(intervalMs * 8, MAX_BACKOFF_CAP_MS);
  const minResumeGapMs = options.minResumeGapMs ?? 5_000;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const doc = options.doc ?? (typeof document !== 'undefined' ? document : undefined);

  let running = false;
  let inFlight = false;
  let failures = 0;
  let lastRunAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Bumped on stop() so a task still in flight can't re-arm the timer of a poller that has been torn down.
  let generation = 0;

  const isHidden = () => Boolean(doc?.hidden);

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const schedule = () => {
    clearTimer();
    // A hidden tab arms nothing; the visibility handler resumes it.
    if (!running || isHidden()) return;

    timer = setTimeout(
      () => void run(),
      nextPollDelayMs({ intervalMs, failures, jitter, maxBackoffMs, random: random() })
    );
  };

  const run = async () => {
    clearTimer();
    if (!running || isHidden()) return;
    if (inFlight) return;
    if (options.isEnabled && !options.isEnabled()) {
      schedule();
      return;
    }

    const runGeneration = generation;
    inFlight = true;
    lastRunAt = now();
    let ok = true;
    try {
      ok = (await task()) !== false;
    } catch {
      ok = false;
    } finally {
      inFlight = false;
    }

    if (runGeneration !== generation) {
      // The poller was stopped (and possibly restarted) while this ran: don't count its result, just make sure a
      // restarted poller still has a timer armed.
      if (running) schedule();
      return;
    }

    failures = ok ? 0 : failures + 1;
    schedule();
  };

  const onVisibility = () => {
    if (!running) return;

    if (isHidden()) {
      clearTimer();
      return;
    }

    if (now() - lastRunAt >= minResumeGapMs) {
      void run();
    } else {
      schedule();
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      failures = 0;
      doc?.addEventListener('visibilitychange', onVisibility);

      if ((options.immediate ?? true) && !isHidden()) {
        void run();
      } else {
        schedule();
      }
    },
    stop() {
      if (!running) return;
      running = false;
      generation++;
      clearTimer();
      doc?.removeEventListener('visibilitychange', onVisibility);
    }
  };
}
