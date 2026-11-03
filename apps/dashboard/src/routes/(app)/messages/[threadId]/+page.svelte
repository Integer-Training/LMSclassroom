<script lang="ts">
  import * as Page from '@cio/ui/base/page';
  import * as Empty from '@cio/ui/base/empty';
  import { Button } from '@cio/ui/base/button';
  import MessagesSquareIcon from '@lucide/svelte/icons/messages-square';
  import MessageThread from '$features/messaging/components/message-thread.svelte';
  import { messagingApi } from '$features/messaging/api/messaging.svelte';

  let { data } = $props();

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
            <Button variant="ghost" href="/messages">Back to messages</Button>
          </div>
        </Empty.Root>
      {:else}
        <p class="ui:text-muted-foreground text-sm">Loading…</p>
      {/if}
    {/snippet}
  </Page.Body>
</Page.Root>
