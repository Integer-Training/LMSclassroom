import * as Sentry from '@sentry/sveltekit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';
import { handleErrorWithSentry } from '@sentry/sveltekit';
import { installGlobalClientErrorListeners, reportClientError } from '$lib/utils/functions/client-error-log';

const dsn = env.PUBLIC_SENTRY_DSN?.trim();
// K6 — disabled by default: needs PUBLIC_SENTRY_DSN plus the explicit opt-in PUBLIC_SENTRY_ENABLED=true (self-hosting
// alone no longer blocks it). No PII, no session replay unless the operator sets a rate, traces default to 5%.
const sentryOptedIn = env.PUBLIC_SENTRY_ENABLED?.trim().toLowerCase() === 'true';

// Sample rate from env, falling back (also on junk or out-of-range values) to the given default.
function sampleRate(raw: string | undefined, fallback: number): number {
  const parsed = raw?.trim() ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

if (dsn && sentryOptedIn && !dev) {
  Sentry.init({
    dsn,
    environment: env.PUBLIC_SENTRY_ENVIRONMENT?.trim() || 'production',
    sendDefaultPii: false,
    tracesSampleRate: sampleRate(env.PUBLIC_SENTRY_TRACES_SAMPLE_RATE, 0.05),
    replaysSessionSampleRate: sampleRate(env.PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE, 0),
    replaysOnErrorSampleRate: sampleRate(env.PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE, 0),
    integrations: [Sentry.replayIntegration()]
  });
}

installGlobalClientErrorListeners();

export const handleError = handleErrorWithSentry((input) => {
  reportClientError(input.error);
});
