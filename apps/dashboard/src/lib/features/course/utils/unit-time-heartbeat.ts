import { classroomio } from '$lib/utils/services/api';

// PearlLMS Phase 9 — active-time heartbeat (client half). A Svelte action wired into the LEARNER lesson
// view only (never staff / edit-mode). It accrues ACTIVE seconds — the page is visible AND the user has
// interacted within the idle window — and PUTs them to the capped `/time` endpoint every ~30s, flushing a
// final beat when the tab is hidden or the page unloads. Accrual pauses while hidden or idle. A beat is
// never sent for < 1s. The server caps each beat, so a wildly wrong client can never inflate a total.

const TICK_MS = 1_000;
const BEAT_EVERY_TICKS = 30; // send roughly every 30s
const IDLE_LIMIT_MS = 60_000; // "active" = interacted within the last 60s
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'scroll', 'click'] as const;

export interface UnitTimeHeartbeatParams {
  courseId: string;
  lessonId: string;
  /** Run only when true — a learner viewing a lesson. Staff / edit-mode / locked content pass false. */
  enabled: boolean;
}

/**
 * Svelte action: `use:unitTimeHeartbeat={{ courseId, lessonId, enabled }}`. Manages its own timer +
 * activity listeners and cleans them up on unmount or when disabled. Reacts to param changes (e.g.
 * navigating between lessons, or leaving learner view) via `update`, flushing the accrued time first.
 */
export function unitTimeHeartbeat(_node: HTMLElement, params: UnitTimeHeartbeatParams) {
  let { courseId, lessonId, enabled } = params;

  let accrued = 0; // active seconds not yet sent
  let sinceBeat = 0; // ticks since the last beat attempt
  let lastActivity = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const markActive = () => {
    lastActivity = Date.now();
  };

  const isActive = () =>
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible' &&
    Date.now() - lastActivity <= IDLE_LIMIT_MS;

  const flush = (keepalive = false) => {
    const seconds = Math.round(accrued);
    if (seconds < 1) return;
    accrued = 0;
    try {
      void classroomio.course[':courseId'].lesson[':lessonId'].time.$put(
        { param: { courseId, lessonId }, json: { seconds } },
        keepalive ? { init: { keepalive: true } } : undefined
      );
    } catch {
      /* best-effort telemetry — a dropped beat is acceptable */
    }
  };

  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush(true);
  };
  const onPageHide = () => flush(true);

  const tick = () => {
    if (isActive()) accrued += TICK_MS / 1_000;
    sinceBeat += 1;
    if (sinceBeat >= BEAT_EVERY_TICKS) {
      sinceBeat = 0;
      flush();
    }
  };

  const start = () => {
    if (running || typeof window === 'undefined') return;
    running = true;
    accrued = 0;
    sinceBeat = 0;
    lastActivity = Date.now();
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, markActive, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    timer = setInterval(tick, TICK_MS);
  };

  const stop = (flushFinal: boolean) => {
    if (!running) return;
    running = false;
    if (timer) clearInterval(timer);
    timer = null;
    for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, markActive);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('beforeunload', onPageHide);
    if (flushFinal) flush(true);
  };

  if (enabled) start();

  return {
    update(next: UnitTimeHeartbeatParams) {
      const lessonChanged = next.lessonId !== lessonId || next.courseId !== courseId;
      // Flush what we accrued against the OUTGOING (course, lesson) before switching context.
      if (running && (lessonChanged || !next.enabled)) stop(true);
      courseId = next.courseId;
      lessonId = next.lessonId;
      enabled = next.enabled;
      if (enabled && !running) start();
    },
    destroy() {
      stop(true);
    }
  };
}
