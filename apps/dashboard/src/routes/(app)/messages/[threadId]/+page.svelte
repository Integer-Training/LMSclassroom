<script lang="ts">
  import * as Page from '@cio/ui/base/page';
  import * as Empty from '@cio/ui/base/empty';
  import { Button } from '@cio/ui/base/button';
  import { page } from '$app/stores';
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import MessagesSquareIcon from '@lucide/svelte/icons/messages-square';
  import MessageThread from '$features/messaging/components/message-thread.svelte';
  import { messagingApi } from '$features/messaging/api/messaging.svelte';

  let { data } = $props();

  // Tutors and Admins reach this page from the caseload inbox; learners from their own /messages list.
  const role = $derived(($page.data.locals?.actor as { role?: string } | undefined)?.role);
  const backHref = $derived(role === 'TUTOR' || role === 'ADMIN' ? '/caseload/messages' : '/messages');

  function retry() {
    if (data.threadId) void messagingApi.loadThread(data.threadId);
  }

  // Load the specific thread whenever the route's threadId changes.
  $effect(() => {
    const threadId = data.threadId;
    messagingApi.reset();
    if (threadId) void messagingApi.loadThread(threadId);
  });
</script>

<svelte:head><title>Conversation</title></svelte:head>

<Page.Root class="mx-auto w-[92%] px-4 md:max-w-3xl">
  <Page.Header>
    <a
      href={backHref}
      class="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1.5 text-sm"
    >
      <ArrowLeftIcon class="size-4" /> Back to messages
    </a>
    <Page.HeaderContent><Page.Title>Conversation</Page.Title></Page.HeaderContent>
  </Page.Header>
  <Page.Body>
    {#snippet child()}
      {#if messagingApi.view}
        <MessageThread view={messagingApi.view} />
      {:else if messagingApi.loadError}
        <Empty.Root class="py-12">
          <Empty.Header>
            <Empty.Media variant="icon"><MessagesSquareIcon /></Empty.Media>
            <Empty.Title>We couldn't load this conversation</Empty.Title>
            <Empty.Description>{messagingApi.loadError}</Empty.Description>
          </Empty.Header>
          <div class="flex gap-2">
            <Button variant="outline" onclick={retry}>Retry</Button>
            <Button variant="ghost" href={backHref}>Back to messages</Button>
          </div>
        </Empty.Root>
      {:else}
        <p class="ui:text-muted-foreground text-sm">Loading…</p>
      {/if}
    {/snippet}
  </Page.Body>
</Page.Root>
