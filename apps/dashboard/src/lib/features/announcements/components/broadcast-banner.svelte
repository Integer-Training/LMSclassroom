<script lang="ts">
  import { onMount } from 'svelte';
  import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
  import XIcon from '@lucide/svelte/icons/x';
  import { announcementsApi } from '$features/announcements/api/announcements.svelte';

  // A prominent, dismissable broadcast banner — the FIRST thing a tutor/learner sees. Shows the newest
  // un-dismissed, unarchived broadcasts addressed to them (accent card, megaphone). Dismissal is remembered
  // per device (localStorage), so a new broadcast reappears while old ones stay dismissed.

  const STORAGE_KEY = 'pearl.dismissedBroadcasts';
  const MAX_SHOWN = 3;

  let dismissed = $state<string[]>([]);

  onMount(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) dismissed = JSON.parse(raw) as string[];
    } catch {
      // ignore unavailable/blocked storage
    }
    announcementsApi.loadFeed();
  });

  const unread = $derived(
    announcementsApi.items.filter((a) => !a.archived && !dismissed.includes(a.id)).slice(0, MAX_SHOWN)
  );

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dismissed));
    } catch {
      // ignore
    }
  }

  function dismiss(id: string) {
    if (!dismissed.includes(id)) dismissed = [...dismissed, id];
    persist();
  }

  function fmtDate(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
</script>

{#if unread.length}
  <div class="mb-5 space-y-2">
    {#each unread as a (a.id)}
      <div class="border-primary bg-primary/5 flex items-start gap-3 rounded-xl border border-l-4 p-4">
        <MegaphoneIcon class="text-primary mt-0.5 size-5 shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="flex items-start justify-between gap-3">
            <p class="font-semibold break-words">{a.title}</p>
            <span class="text-muted-foreground shrink-0 text-xs whitespace-nowrap">{fmtDate(a.publishedAt)}</span>
          </div>
          <p class="text-muted-foreground mt-0.5 text-sm break-words whitespace-pre-wrap">{a.body}</p>
        </div>
        <button
          type="button"
          onclick={() => dismiss(a.id)}
          class="text-muted-foreground hover:text-foreground -mr-1 shrink-0 rounded p-1"
          aria-label="Dismiss announcement"
        >
          <XIcon class="size-4" />
        </button>
      </div>
    {/each}
  </div>
{/if}
