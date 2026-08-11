// PostHog telemetry removed for privacy (PearlLMS fork). The vendor build sent
// server-side events to app.posthog.com from the redirect routes. This is now an
// inert stub so those routes keep compiling but no data leaves. Do not
// reintroduce the `posthog-node` client.

export const client = {
  capture(_event: { distinctId: string; event: string; properties?: Record<string, unknown> }): void {},
  async shutdownAsync(): Promise<void> {}
};
