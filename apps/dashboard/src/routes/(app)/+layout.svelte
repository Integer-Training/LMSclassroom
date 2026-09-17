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

  interface Props {
    children?: import('svelte').Snippet;
    data: {
      isOrgSite: boolean;
      orgSiteName: string;
      org: import('$features/app/types').AccountOrg | null;
      skipAuth: boolean;
      locals: App.Locals;
    };
  }

  let { children, data }: Props = $props();

  let path = $derived(page.url.pathname);

  const session = authClient.useSession();
  let authed = $derived(!!$session.data);

  // Live-presence heartbeat: while signed in, ping every 60s so "Online now" reflects real activity (the
  // panel counts sessions refreshed within 5 minutes). Best-effort — failures are ignored.
  onMount(() => {
    const HEARTBEAT_MS = 60_000;
    const ping = () => {
      if (authed) void classroomio.account.heartbeat.$post().catch(() => {});
    };
    ping();
    const timer = setInterval(ping, HEARTBEAT_MS);
    return () => clearInterval(timer);
  });

  $effect(() => {
    if ($session.isPending || $session.isRefetching || !!$session.data) {
      return;
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
