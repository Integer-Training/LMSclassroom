<script>
  import { page } from '$app/state';
  import { Button } from '@cio/ui/base/button';
  import { Empty } from '@cio/ui/custom/empty';
  import { HomeIcon, HoverableItem } from '@cio/ui/custom/moving-icons';
  import HeartCrack from '@lucide/svelte/icons/heart-crack';

  const isNotFound = $derived(page.status === 404);
  const isForbidden = $derived(page.status === 403);

  console.error('Error message:', page.error?.message);
  console.error('Error page:', page.url);

  // `/` sends a signed-in user to their own role home (learner /lms, tutor /caseload, manager /reports,
  // admin /org/{slug}/dash) and anyone signed out to /login. A full load also picks up a newer build.
  function goHome() {
    window.location.href = '/';
  }
</script>

<svelte:head>
  <title>
    {isNotFound ? 'Page not found' : isForbidden ? 'No access to this page' : 'Something unexpected occurred'}
  </title>
</svelte:head>

{#if isNotFound || isForbidden}
  <Empty
    title={isNotFound ? 'Page not found' : 'You don’t have access to this page'}
    description={isNotFound
      ? "The page you're looking for doesn't exist or you don't have permission to view it."
      : 'This page is not part of your account. Use the button below to go to your own dashboard.'}
    icon={HeartCrack}
    variant="page"
    layout="full-page"
    showLogo={false}
  >
    <div class="flex gap-2">
      <HoverableItem>
        {#snippet children(isHovered)}
          <Button onclick={goHome}>
            <HomeIcon {isHovered} size={16} ariaHidden={true} />
            Go to my dashboard
          </Button>
        {/snippet}
      </HoverableItem>
    </div>
  </Empty>
{:else}
  <Empty
    title="Something unexpected occurred."
    description="Don't worry, your learning is safe. Please reload the page or go to your dashboard. If it keeps happening, contact support."
    icon={HeartCrack}
    variant="page"
    layout="full-page"
    showLogo={false}
  >
    <div class="flex gap-2">
      <Button variant="secondary" onclick={() => window.location.reload()}>Reload page</Button>
      <HoverableItem>
        {#snippet children(isHovered)}
          <Button onclick={goHome}>
            <HomeIcon {isHovered} size={16} ariaHidden={true} />
            Go to my dashboard
          </Button>
        {/snippet}
      </HoverableItem>
    </div>
  </Empty>
{/if}
