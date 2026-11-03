<script lang="ts">
  import { onMount } from 'svelte';
  import * as Page from '@cio/ui/base/page';
  import * as Empty from '@cio/ui/base/empty';
  import { Button } from '@cio/ui/base/button';
  import MessagesSquareIcon from '@lucide/svelte/icons/messages-square';
  import MessageThread from '$features/messaging/components/message-thread.svelte';
  import { messagingApi } from '$features/messaging/api/messaging.svelte';

  // Learner entry: resolve the allocated tutor(s). One tutor opens straight into the pair thread; with
  // several the learner chooses whom to message. No tutor → the empty state.
  async function load() {
    messagingApi.reset();
    await messagingApi.loadMyTutors();
    if (messagingApi.myTutors.length === 1) await messagingApi.open(messagingApi.myTutors[0].tutorId);
  }

  onMount(load);
</script>

<svelte:head><title>Messages</title></svelte:head>

<Page.Root class="mx-auto w-[92%] px-4 md:max-w-3xl">
  <Page.Header>
    <Page.HeaderContent><Page.Title>Messages</Page.Title></Page.HeaderContent>
  </Page.Header>
  <Page.Body>
    {#snippet child()}
      {#if messagingApi.loadError && !messagingApi.view}
        <Empty.Root class="py-12">
          <Empty.Header>
            <Empty.Media variant="icon"><MessagesSquareIcon /></Empty.Media>
            <Empty.Title>We couldn't load your messages</Empty.Title>
            <Empty.Description>{messagingApi.loadError}</Empty.Description>
          </Empty.Header>
          <Button variant="outline" onclick={load}>Retry</Button>
        </Empty.Root>
      {:else if messagingApi.tutorsLoaded && messagingApi.myTutors.length === 0}
        <Empty.Root class="py-12">
          <Empty.Header>
            <Empty.Media variant="icon"><MessagesSquareIcon /></Empty.Media>
            <Empty.Title>No tutor yet</Empty.Title>
            <Empty.Description>You'll be able to message your tutor once one is allocated.</Empty.Description>
          </Empty.Header>
        </Empty.Root>
      {:else if messagingApi.view}
        {#if messagingApi.myTutors.length > 1}
          <Button variant="ghost" size="sm" class="mb-2" onclick={() => (messagingApi.view = null)}>All tutors</Button>
        {/if}
        <MessageThread view={messagingApi.view} />
      {:else if messagingApi.myTutors.length > 1}
        <div class="mx-auto flex w-full max-w-2xl flex-col gap-2">
          <p class="ui:text-muted-foreground text-sm">Who would you like to message?</p>
          {#each messagingApi.myTutors as tutor (tutor.tutorId)}
            <Button
              variant="outline"
              class="justify-start"
              loading={messagingApi.isLoading}
              onclick={() => messagingApi.open(tutor.tutorId)}
            >
              {tutor.name}
            </Button>
          {/each}
        </div>
      {:else}
        <p class="ui:text-muted-foreground text-sm">Loading…</p>
      {/if}
    {/snippet}
  </Page.Body>
</Page.Root>
