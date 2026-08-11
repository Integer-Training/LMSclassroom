// PostHog telemetry removed for privacy (PearlLMS fork). The vendor build shipped
// learner email + name to eu.posthog.com. This module now exports inert no-ops so
// the existing call-sites keep compiling but no analytics client is ever
// constructed and no data leaves. Do not reintroduce the `posthog-js` client.

export const capturePosthogEvent = (_event: string, _properties?: Record<string, unknown>): void => {};

export const identifyPosthogUser = (_id: string, _properties?: Record<string, unknown>): void => {};

export type PosthogBootstrapUser = {
  id: string;
  email?: string | null;
  name?: string | null;
};

export const initPosthog = (_user?: PosthogBootstrapUser): void => {};
