// Graceful shutdown for the API process. `docker stop` / a redeploy sends SIGTERM: stop accepting new connections,
// let in-flight requests (an upload, a report, a certificate render) finish within a deadline, then release the
// DB pool / Redis / BullMQ connections and exit. Kept dependency-injected so it is unit-testable.

export interface ClosableServer {
  close(callback?: (error?: Error) => void): unknown;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}

export interface ShutdownOptions {
  server: ClosableServer;
  /** How long in-flight requests may keep running after SIGTERM before connections are cut. */
  timeoutMs: number;
  /** Released after the server has drained, each independently (one failing never blocks the rest). */
  cleanup: Array<{ name: string; run: () => Promise<unknown> }>;
  exit?: (code: number) => void;
  log?: (message: string, detail?: unknown) => void;
}

export function resolveShutdownTimeoutMs(raw: string | undefined, fallbackSeconds = 25): number {
  const seconds = Number(raw);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : fallbackSeconds) * 1000;
}

export function createShutdownHandler(options: ShutdownOptions): (signal: string) => Promise<void> {
  const { server, timeoutMs, cleanup } = options;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const log = options.log ?? ((message: string, detail?: unknown) => console.log(message, detail ?? ''));
  let shuttingDown: Promise<void> | undefined;

  return (signal: string) => {
    // A second SIGTERM/SIGINT while draining must not start a second shutdown.
    shuttingDown ??= (async () => {
      log(`Received ${signal}, draining in-flight requests (up to ${timeoutMs}ms)`);

      let timer: ReturnType<typeof setTimeout> | undefined;
      const drained = new Promise<'drained'>((resolve) => {
        server.close(() => resolve('drained'));
        // Keep-alive sockets with no request in flight would otherwise hold close() open.
        server.closeIdleConnections?.();
      });
      const deadline = new Promise<'deadline'>((resolve) => {
        timer = setTimeout(() => resolve('deadline'), timeoutMs);
      });

      const outcome = await Promise.race([drained, deadline]);
      if (timer) clearTimeout(timer);

      if (outcome === 'deadline') {
        log('Shutdown deadline reached, closing remaining connections');
        server.closeAllConnections?.();
      }

      const results = await Promise.allSettled(cleanup.map((step) => step.run()));
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          log(`Shutdown step "${cleanup[index]?.name}" failed`, result.reason);
        }
      });

      exit(0);
    })();

    return shuttingDown;
  };
}
