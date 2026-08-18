<script lang="ts">
  import { onMount } from 'svelte';
  import * as Page from '@cio/ui/base/page';
  import * as Empty from '@cio/ui/base/empty';
  import MessagesSquareIcon from '@lucide/svelte/icons/messages-square';
  import MessageThread from '$features/messaging/components/message-thread.svelte';
  import { messagingApi } from '$features/messaging/api/messaging.svelte';

  // Learner entry: resolve the allocated tutor and open the pair thread, or show the empty state.
  onMount(async () => {
    messagingApi.reset();
    await messagingApi.loadMyTutor();
    if (messagingApi.myTutor) await messagingApi.open(messagingApi.myTutor.tutorId);
  });
</script>

<svelte:head><title>Messages</title></svelte:head>

<Page.Root class="mx-auto w-[92%] px-4 md:max-w-3xl">
  <Page.Header>
    <Page.HeaderContent><Page.Title>Messages</Page.Title></Page.HeaderContent>
  </Page.Header>
  <Page.Body>
    {#snippet child()}
      {#if messagingApi.tutorLoaded && !messagingApi.myTutor}
        <Empty.Root class="py-12">
          <Empty.Header>
            <Empty.Media variant="icon"><MessagesSquareIcon /></Empty.Media>
            <Empty.Title>No tutor yet</Empty.Title>
            <Empty.Description>You'll be able to message your tutor once one is allocated.</Empty.Description>
          </Empty.Header>
        </Empty.Root>
      {:else if messagingApi.view}
        <MessageThread view={messagingApi.view} />
      {:else}
        <p class="ui:text-muted-foreground text-sm">Loading…</p>
      {/if}
    {/snippet}
  </Page.Body>
</Page.Root>
