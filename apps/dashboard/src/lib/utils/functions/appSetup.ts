import { PUBLIC_IS_SELFHOSTED } from '$env/static/public';
import type { PosthogBootstrapUser } from '$lib/utils/services/posthog';
import { initUserJot } from '$lib/utils/services/userjot';
import { licenseApi } from '$features/license/api/license.svelte';

// PostHog + umami telemetry removed for privacy (PearlLMS fork) — the tracking
// init calls are gone. The setup entry points are kept (callers depend on them)
// and now only drive the UserJot feedback widget, which is itself disabled when
// self-hosted (see services/userjot). No analytics client is ever constructed.

export function setupAnalytics(_user?: PosthogBootstrapUser) {
  initUserJot();
}

/** Checks if this is cloud deployment and initializes analytics */
export function setupCloudAnalytics(user?: PosthogBootstrapUser) {
  if (PUBLIC_IS_SELFHOSTED !== 'true') {
    setupAnalytics(user);
  }
}

export function setupAnalyticsBasedOnLicense(_user?: PosthogBootstrapUser) {
  initUserJot();

  if (licenseApi.hasAccess('no-tracking')) {
    return;
  }
}
