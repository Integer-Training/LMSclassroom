<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import BellIcon from '@lucide/svelte/icons/bell';
  import CheckCheckIcon from '@lucide/svelte/icons/check-check';
  import { Button } from '@cio/ui/base/button';
  import * as Popover from '@cio/ui/base/popover';
  import * as Empty from '@cio/ui/base/empty';
  import { notificationCentreApi } from '$features/notifications/api/notification-centre.svelte';

  // PearlLMS Phase 6 Step 3 — the notification bell, shared by every role's header. Unread badge + a
  // newest-first list; each item links to its subject and marks itself read on click; a mark-all control.
  // Data loads on mount + on open + a light 60s poll (no realtime infra). Deep links land on guarded
  // surfaces — the link is a convenience, the target's own guards are the control.

  let open = $state(false);
  const POLL_MS = 60_000;
  let poll: ReturnType<typeof setInterval> | undefined;

  function timeAgo(iso: string): string {
    const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  async function openItem(item: { id: string; link: string; read: boolean }) {
    open = false;
    if (!item.read) void notificationCentreApi.markRead(item.id);
    if (item.link && item.link !== '#') await goto(item.link);
  }

  $effect(() => {
    // refresh the list whenever the popover is opened
    if (open) void notificationCentreApi.load();
  });

  onMount(() => {
    void notificationCentreApi.load();
    poll = setInterval(() => void notificationCentreApi.load(), POLL_MS);
  });
  onDestroy(() => {
    if (poll) clearInterval(poll);
  });
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    <div class="relative">
      <Button variant="outline" size="icon" aria-label="Notifications">
        <BellIcon class="custom rounded-full" />
      </Button>
      {#if notificationCentreApi.unreadCount > 0}
        <span
          class="ui:bg-primary ui:text-primary-foreground absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums"
        >
          {notificationCentreApi.unreadCount > 99 ? '99+' : notificationCentreApi.unreadCount}
        </span>
      {/if}
    </div>
  </Popover.Trigger>
  <Popover.Content class="w-80 p-0">
    <div class="ui:border-border flex items-center justify-between border-b px-3 py-2">
      <span class="text-sm font-semibold">Notifications</span>
      {#if notificationCentreApi.unreadCount > 0}
        <button
          class="ui:text-muted-foreground hover:ui:text-foreground flex items-center gap-1 text-xs"
          onclick={() => void notificationCentreApi.markAllRead()}
        >
          <CheckCheckIcon size={13} /> Mark all read
        </button>
      {/if}
    </div>

    {#if notificationCentreApi.items.length === 0}
      <Empty.Root class="py-8">
        <Empty.Header>
          <Empty.Media variant="icon"><BellIcon /></Empty.Media>
          <Empty.Title>No notifications</Empty.Title>
          <Empty.Description>You're all caught up. New notifications will appear here.</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <ul class="max-h-96 overflow-y-auto">
        {#each notificationCentreApi.items as item (item.id)}
          <li class="ui:border-border border-b last:border-b-0">
            <button
              class="hover:ui:bg-muted/60 flex w-full items-start gap-2 px-3 py-2 text-left"
              onclick={() => openItem(item)}
            >
              {#if !item.read}
                <span class="ui:bg-primary mt-1.5 h-2 w-2 shrink-0 rounded-full" aria-label="unread"></span>
              {:else}
                <span class="mt-1.5 h-2 w-2 shrink-0"></span>
              {/if}
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm {item.read ? 'ui:text-muted-foreground' : 'font-medium'}">
                  {item.subject}
                </span>
                <span class="ui:text-muted-foreground text-xs">{timeAgo(item.createdAt)}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </Popover.Content>
</Popover.Root>
