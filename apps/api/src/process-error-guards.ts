import * as Sentry from '@sentry/node';

import { isTransientRedisError, logTransientRedisEvent } from '@cio/core/utils/redis/redis';

function reportFatalUncaughtException(error: unknown): void {
  console.error('Uncaught exception:', error);
  Sentry.captureException(error);
  void Sentry.flush(2000).finally(() => process.exit(1));
}

/**
 * Custom process guards (see instrument.ts: Sentry's default OnUncaughtException /
 * OnUnhandledRejection integrations are filtered out when Sentry inits so these
 * own flush/exit). Transient Redis maintenance errors must not take down the API, and neither may a stray
 * unhandled promise rejection (logged + reported only; `uncaughtException` still exits).
 */
export function registerProcessErrorGuards(): void {
  process.on('uncaughtException', (error) => {
    if (isTransientRedisError(error)) {
      logTransientRedisEvent('Ignoring transient Redis error (client will reconnect):', error);
      return;
    }

    reportFatalUncaughtException(error);
  });

  process.on('unhandledRejection', (reason) => {
    if (isTransientRedisError(reason)) {
      logTransientRedisEvent('Ignoring transient Redis rejection (client will reconnect):', reason);
      return;
    }

    // One late Redis/DB/S3 rejection from a fire-and-forget call must not kill every in-flight request.
    console.error('Unhandled rejection:', reason);
    Sentry.captureException(reason);
  });
}
