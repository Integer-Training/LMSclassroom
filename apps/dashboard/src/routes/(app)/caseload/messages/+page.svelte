<script lang="ts">
  import { onMount } from 'svelte';
  import * as Page from '@cio/ui/base/page';
  import * as Empty from '@cio/ui/base/empty';
  import { Badge } from '@cio/ui/base/badge';
  import MessagesSquareIcon from '@lucide/svelte/icons/messages-square';
  import { messagingApi } from '$features/messaging/api/messaging.svelte';

  // Tutor Messages inbox. Lists every conversation the tutor participates in (a row per learner), newest
  // first, with an unread dot. Each row opens the thread at /messages/[threadId] (reply happens there).

  onMount(() => {
    messagingApi.resetList();
    messagingApi.loadConversations();
  });

  const conversations = $derived(messagingApi.conversations);
  const loaded = $derived(messagingApi.conversationsLoaded);

  // today → time, this year → "D Mon", older → "D Mon YYYY".
  function when(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      ...(sameYear ? {} : { year: 'numeric' })
    });
  }
</script>

<svelte:head><title>Messages</title></svelte:head>

<Page.Root class="w-full">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>Messages</Page.Title>
      <Page.Subtitle>Conversations with your learners</Page.Subtitle>
    </Page.HeaderContent>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      {#if !loaded}
        <p class="ui:text-muted-foreground text-sm">Loading…</p>
      {:else if conversations.length === 0}
        <Empty.Root class="py-12">
          <Empty.Header>
            <Empty.Media variant="icon"><MessagesSquareIcon /></Empty.Media>
            <Empty.Title>No messages yet</Empty.Title>
            <Empty.Description>
              When a learner messages you it appears here. You can also start one from a learner's page.
            </Empty.Description>
          </Empty.Header>
        </Empty.Root>
      {:else}
        <div class="bg-card divide-y rounded-xl border">
          {#each conversations as c (c.threadId)}
            <a
              href="/messages/{c.threadId}"
              class="hover:bg-muted/50 flex items-center gap-3 px-4 py-3 transition-colors"
            >
              <span class="size-2 shrink-0 rounded-full {c.unread ? 'bg-primary' : 'bg-transparent'}" aria-hidden="true"
              ></span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="truncate text-sm {c.unread ? 'font-semibold' : 'font-medium'}">{c.counterpart.name}</span
                  >
                  {#if c.archived}
                    <Badge variant="outline" class="shrink-0">Archived</Badge>
                  {/if}
                </div>
                <p class="ui:text-muted-foreground truncate text-xs">{c.lastBody}</p>
              </div>
              <span class="ui:text-muted-foreground shrink-0 text-xs whitespace-nowrap">{when(c.lastAt)}</span>
            </a>
          {/each}
        </div>
      {/if}
    {/snippet}
  </Page.Body>
</Page.Root>
