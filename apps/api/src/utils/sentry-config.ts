/**
 * Pure decision for `instrument.ts` (no imports: that file must stay the first import of the api entry point).
 * Sentry is OFF unless an operator opts in with BOTH `SENTRY_DSN` and `SENTRY_ENABLED=true`, in production only.
 * Self-hosting no longer disables it on its own (the old `!isSelfHosted` gate made it impossible to use here).
 * Privacy: `sendDefaultPii` is always false; traces default to 5% (override with `SENTRY_TRACES_SAMPLE_RATE`).
 */
export type SentryEnv = Record<string, string | undefined>;

export const DEFAULT_SENTRY_TRACES_SAMPLE_RATE = 0.05;

export function resolveSentryConfig(env: SentryEnv) {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn || env.NODE_ENV !== 'production' || env.SENTRY_ENABLED?.trim().toLowerCase() !== 'true') return null;

  const rawRate = env.SENTRY_TRACES_SAMPLE_RATE?.trim();
  const parsedRate = rawRate ? Number(rawRate) : NaN;
  const tracesSampleRate =
    Number.isFinite(parsedRate) && parsedRate >= 0 && parsedRate <= 1 ? parsedRate : DEFAULT_SENTRY_TRACES_SAMPLE_RATE;

  return {
    dsn,
    environment: env.SENTRY_ENVIRONMENT?.trim() || 'production',
    tracesSampleRate,
    sendDefaultPii: false as const
  };
}
