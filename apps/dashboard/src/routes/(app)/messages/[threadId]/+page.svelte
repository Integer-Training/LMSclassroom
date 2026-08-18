<script lang="ts">
  import * as Page from '@cio/ui/base/page';
  import MessageThread from '$features/messaging/components/message-thread.svelte';
  import { messagingApi } from '$features/messaging/api/messaging.svelte';

  let { data } = $props();

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
    <Page.HeaderContent><Page.Title>Conversation</Page.Title></Page.HeaderContent>
  </Page.Header>
  <Page.Body>
    {#snippet child()}
      {#if messagingApi.view}
        <MessageThread view={messagingApi.view} />
      {:else}
        <p class="ui:text-muted-foreground text-sm">Loading…</p>
      {/if}
    {/snippet}
  </Page.Body>
</Page.Root>
