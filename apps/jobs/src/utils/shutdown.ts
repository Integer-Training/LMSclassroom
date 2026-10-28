// One coordinated shutdown for the whole jobs process. Previously every worker file registered its own SIGTERM
// handler that closed ITS worker and then called process.exit(0): whichever finished first (an idle worker) killed
// the process while another (a running ffmpeg / Whisper / email) was still mid-job. Now each worker registers a
// close task and a single handler drains them all in parallel, then releases the shared connections and exits.
//
// Kept free of app imports (deps are injected by bootstrap.ts) so it is unit-testable.

export type ShutdownTask = (force: boolean) => Promise<unknown>;

export interface ShutdownDeps {
  /** Total time workers may keep finishing in-flight jobs after the signal, before being forced. */
  timeoutMs: number;
  /** Kill any child process (ffmpeg) still alive once the grace is spent, so none is orphaned. */
  killChildren: () => number;
  /** Release shared resources once the workers are down (queue producer, redis, db pool). */
  afterWorkers: () => Promise<unknown>;
  exit: (code: number) => void;
  log: (message: string, detail?: Record<string, unknown>) => void;
}

const tasks = new Map<string, ShutdownTask>();

export function registerShutdownTask(name: string, close: ShutdownTask): void {
  tasks.set(name, close);
}

/** Test seam. */
export function clearShutdownTasks(): void {
  tasks.clear();
}

/** Seconds from `SHUTDOWN_TIMEOUT`, else 270s (inside the 300s compose `stop_grace_period`). */
export function resolveShutdownTimeoutMs(raw: string | undefined): number {
  const seconds = Number(raw);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 270) * 1000;
}

export function createShutdown(deps: ShutdownDeps): (signal: string) => Promise<void> {
  let running: Promise<void> | undefined;

  return (signal: string) => {
    running ??= (async () => {
      const entries = [...tasks.entries()];
      deps.log('jobs-shutdown-start', { signal, workers: entries.map(([name]) => name), timeoutMs: deps.timeoutMs });

      const closeAll = (force: boolean) =>
        Promise.allSettled(
          entries.map(async ([name, close]) => {
            try {
              await close(force);
            } catch (error) {
              deps.log('jobs-shutdown-task-failed', {
                name,
                error: error instanceof Error ? error.message : String(error)
              });
            }
          })
        );

      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        closeAll(false).then(() => 'drained' as const),
        new Promise<'deadline'>((resolve) => {
          timer = setTimeout(() => resolve('deadline'), deps.timeoutMs);
        })
      ]);
      if (timer) clearTimeout(timer);

      if (outcome === 'deadline') {
        const killed = deps.killChildren();
        deps.log('jobs-shutdown-deadline', { killedChildren: killed });
        // Force-close without waiting for active jobs (BullMQ re-queues them as stalled); bounded so exit is certain.
        await Promise.race([closeAll(true), new Promise((resolve) => setTimeout(resolve, 5_000).unref())]);
      }

      try {
        await deps.afterWorkers();
      } catch (error) {
        deps.log('jobs-shutdown-cleanup-failed', { error: error instanceof Error ? error.message : String(error) });
      }

      deps.exit(0);
    })();

    return running;
  };
}
