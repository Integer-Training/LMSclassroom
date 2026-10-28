/**
 * Must be imported as the FIRST thing in `apps/api/src/index.ts`. The Sentry
 * Node SDK relies on auto-instrumentation that hooks into Node's `require`
 * resolution and module loaders; any code that runs before this file initializes
 * Sentry will not be traced.
 */
import * as Sentry from '@sentry/node';
import { resolveSentryConfig } from './utils/sentry-config';

// K6 — disabled by default; enabled only by SENTRY_DSN + SENTRY_ENABLED=true in production (see sentry-config.ts).
const sentryConfig = resolveSentryConfig(process.env);

if (sentryConfig) {
  Sentry.init({
    ...sentryConfig,
    // process-error-guards.ts registers handlers with transient Redis filtering.
    integrations(integrations) {
      return integrations.filter(
        (integration) => integration.name !== 'OnUncaughtException' && integration.name !== 'OnUnhandledRejection'
      );
    }
  });
}
