<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';

  import { UpgradeModal, PageLoadProgress, PageRestricted } from '$features/ui';
  import ImpersonationBanner from '$features/ui/impersonation-banner.svelte';
  import { VerifyEmailModal } from '$features/onboarding/components';
  import { CommandPalette, KeyboardShortcutListener } from '$features/search';
  import { isPublicRoute } from '$lib/utils/functions/routes/isPublicRoute';
  import { currentOrg } from '$lib/utils/store/org';
  import { authClient } from '$lib/utils/services/auth/client';
  import { classroomio } from '$lib/utils/services/api';
  import { createVisiblePoll } from '$lib/utils/functions/visible-poll';

  interface Props {
    children?: import('svelte').Snippet;
    data: {
      isOrgSite: boolean;
      orgSiteName: string;
      org: import('$features/app/types').AccountOrg | null;
      skipAuth: boolean;
      locals: import('$lib/utils/services/auth/public-locals').PublicLocals;
    };
  }

  let { children, data }: Props = $props();

  let path = $derived(page.url.pathname);

  const session = authClient.useSession();
  let authed = $derived(!!$session.data);

  // Backoff schedule (ms) for re-checking the session after a failed (not "signed out") check.
  const SESSION_RETRY_DELAYS_MS = [1_000, 3_000, 8_000, 20_000, 45_000];
  let sessionRetries = 0;

  // Live-presence heartbeat: while signed in AND the tab is visible, ping every 60s (+-20% jitter) so "Online now"
  // reflects real activity (the panel counts sessions refreshed within 5 minutes, so the cadence stays 60s). A
  // hidden tab stops pinging and drops out of "Online now" after 5 minutes — intended; it pings again as soon as
  // the tab is visible. Best-effort: failures only back the poll off (the shared helper), nothing is surfaced.
  onMount(() => {
    const poll = createVisiblePoll({
      intervalMs: 60_000,
      isEnabled: () => authed,
      task: async () => {
        try {
          await classroomio.account.heartbeat.$post();
          return true;
        } catch {
          return false;
        }
      }
    });
    poll.start();
    return () => poll.stop();
  });

  $effect(() => {
    if ($session.data) sessionRetries = 0;

    if ($session.isPending || $session.isRefetching || !!$session.data) {
      return;
    }

    // The session check itself failed (network blip / API 5xx): that is NOT "signed out". Stay put (no redirect) and
    // retry with backoff, bounded, so the app finishes initialising once the API is back instead of waiting for a
    // tab refocus. The server guards and the API still reject a genuinely invalid session.
    if ($session.error) {
      if (sessionRetries >= SESSION_RETRY_DELAYS_MS.length) return;
      const timer = setTimeout(() => {
        sessionRetries += 1;
        void $session.refetch({ query: { disableCookieCache: true } });
      }, SESSION_RETRY_DELAYS_MS[sessionRetries]);
      return () => clearTimeout(timer);
    }

    if (data.skipAuth) return;

    if (isPublicRoute(path) && (path !== '/' || data.isOrgSite)) {
      return;
    }

    if (!$session.data && !path.startsWith('/login')) {
      window.location.href = '/login';
    }
  });
</script>

<UpgradeModal />
<VerifyEmailModal />
<ImpersonationBanner />
<CommandPalette />
<KeyboardShortcutListener />

{#if data.org?.isRestricted || $currentOrg.isRestricted}
  <PageRestricted />
{:else}
  <PageLoadProgress zIndex={10000} />

  {@render children?.()}
{/if}
