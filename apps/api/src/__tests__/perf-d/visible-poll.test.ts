import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createVisiblePoll, nextPollDelayMs } from '../../../../dashboard/src/lib/utils/functions/visible-poll';

// PearlLMS scalability Phase D — the shared visibility-aware poll helper: pauses while hidden, refreshes
// immediately on return, jitters every delay, backs off on failure, never overlaps itself. The dashboard has no
// wired test runner, so its pure modules are exercised here (same pattern as perf-c/dashboard-session).

function fakeDoc() {
  const listeners = new Set<() => void>();
  const doc = {
    hidden: false,
    addEventListener: (_: string, fn: () => void) => void listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn),
    setHidden(hidden: boolean) {
      doc.hidden = hidden;
      for (const fn of [...listeners]) fn();
    },
    get listenerCount() {
      return listeners.size;
    }
  };

  return doc;
}

const base = (doc: ReturnType<typeof fakeDoc>, task: () => unknown) => ({
  intervalMs: 60_000,
  task,
  doc: doc as never,
  random: () => 0.5, // zero jitter spread
  now: () => Date.now()
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('nextPollDelayMs', () => {
  const args = { intervalMs: 60_000, failures: 0, jitter: 0.2, maxBackoffMs: 480_000 };

  it('spreads +-20% around the interval (60s => 48s..72s)', () => {
    expect(nextPollDelayMs({ ...args, random: 0 })).toBe(48_000);
    expect(nextPollDelayMs({ ...args, random: 0.5 })).toBe(60_000);
    expect(nextPollDelayMs({ ...args, random: 1 })).toBe(72_000);
  });

  it('doubles per consecutive failure and caps at maxBackoffMs', () => {
    expect(nextPollDelayMs({ ...args, failures: 1, random: 0.5 })).toBe(120_000);
    expect(nextPollDelayMs({ ...args, failures: 2, random: 0.5 })).toBe(240_000);
    expect(nextPollDelayMs({ ...args, failures: 3, random: 0.5 })).toBe(480_000);
    expect(nextPollDelayMs({ ...args, failures: 9, random: 0.5 })).toBe(480_000);
  });
});

describe('createVisiblePoll', () => {
  it('runs immediately, then on the interval', async () => {
    const doc = fakeDoc();
    const task = vi.fn(async () => true);
    const poll = createVisiblePoll(base(doc, task));
    poll.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(task).toHaveBeenCalledTimes(2);
    poll.stop();
  });

  it('does not run immediately when immediate:false', async () => {
    const doc = fakeDoc();
    const task = vi.fn(async () => true);
    const poll = createVisiblePoll({ ...base(doc, task), immediate: false });
    poll.start();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(task).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(task).toHaveBeenCalledTimes(1);
    poll.stop();
  });

  it('makes NO requests while hidden and refreshes immediately when visible again', async () => {
    const doc = fakeDoc();
    const task = vi.fn(async () => true);
    const poll = createVisiblePoll(base(doc, task));
    poll.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);

    doc.setHidden(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(task).toHaveBeenCalledTimes(1); // nothing fired while hidden

    doc.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(2); // one immediate refresh on return

    await vi.advanceTimersByTimeAsync(60_000);
    expect(task).toHaveBeenCalledTimes(3); // and the cadence resumes
    poll.stop();
  });

  it('does not start a request when it starts in a hidden tab, but resumes on visible', async () => {
    const doc = fakeDoc();
    doc.hidden = true;
    const task = vi.fn(async () => true);
    const poll = createVisiblePoll(base(doc, task));
    poll.start();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(task).not.toHaveBeenCalled();

    doc.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    poll.stop();
  });

  it('throttles the on-return refresh when the last run was very recent (rapid tab flips)', async () => {
    const doc = fakeDoc();
    const task = vi.fn(async () => true);
    const poll = createVisiblePoll(base(doc, task));
    poll.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);

    doc.setHidden(true);
    doc.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1); // inside the 5s resume gap => no extra request
    await vi.advanceTimersByTimeAsync(60_000);
    expect(task).toHaveBeenCalledTimes(2);
    poll.stop();
  });

  it('backs off after failures (false or throw) and recovers on success', async () => {
    const doc = fakeDoc();
    const results: Array<boolean | Error> = [false, new Error('429'), true, true];
    const task = vi.fn(async () => {
      const r = results.shift();
      if (r instanceof Error) throw r;

      return r;
    });
    const poll = createVisiblePoll(base(doc, task));
    poll.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1); // failed (false) => next delay 120s

    await vi.advanceTimersByTimeAsync(119_000);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(task).toHaveBeenCalledTimes(2); // threw => next delay 240s

    await vi.advanceTimersByTimeAsync(239_000);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(task).toHaveBeenCalledTimes(3); // success => back to 60s

    await vi.advanceTimersByTimeAsync(60_000);
    expect(task).toHaveBeenCalledTimes(4);
    poll.stop();
  });

  it('skips runs while isEnabled() is false but keeps the cadence', async () => {
    const doc = fakeDoc();
    let enabled = false;
    const task = vi.fn(async () => true);
    const poll = createVisiblePoll({ ...base(doc, task), isEnabled: () => enabled });
    poll.start();
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(task).not.toHaveBeenCalled();

    enabled = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(task).toHaveBeenCalledTimes(1);
    poll.stop();
  });

  it('never overlaps a run that is still in flight', async () => {
    const doc = fakeDoc();
    let release!: () => void;
    const task = vi.fn(() => new Promise<boolean>((res) => (release = () => res(true))));
    const poll = createVisiblePoll(base(doc, task));
    poll.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);

    doc.setHidden(true);
    await vi.advanceTimersByTimeAsync(10_000);
    doc.setHidden(false); // visible again while the first request is still pending
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(task).toHaveBeenCalledTimes(2);
    poll.stop();
  });

  it('stop() clears the timer and the listener; a late task result cannot re-arm it', async () => {
    const doc = fakeDoc();
    let release!: () => void;
    const task = vi.fn(() => new Promise<boolean>((res) => (release = () => res(true))));
    const poll = createVisiblePoll(base(doc, task));
    poll.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(doc.listenerCount).toBe(1);

    poll.stop();
    expect(doc.listenerCount).toBe(0);
    release();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(task).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
