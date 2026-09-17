<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/state';
  import { Badge } from '@cio/ui/base/badge';
  import { orgSummaryApi } from './org-summary.svelte';

  // Per-view header context bar. Shows a live, contextual summary for the current admin section (learners →
  // count · suspended, tutors → count, courses → published · draft, etc.) plus a live "online" pill. Polls
  // the lightweight summary endpoint so counts + presence stay fresh.

  const POLL_MS = 45_000;
  let poll: ReturnType<typeof setInterval> | undefined;

  onMount(() => {
    orgSummaryApi.load();
    poll = setInterval(() => orgSummaryApi.load(), POLL_MS);
  });
  onDestroy(() => {
    if (poll) clearInterval(poll);
  });

  const s = $derived(orgSummaryApi.data);

  // path is /org/<slug>/<section>... ; '' = the org index (dashboard).
  const section = $derived.by(() => {
    const m = page.url.pathname.match(/^\/org\/[^/]+\/([^/]+)/);
    return m ? m[1] : '';
  });

  // Contextual count chips for the current section.
  const chips = $derived.by<string[]>(() => {
    if (!s) return [];
    switch (section) {
      case 'learners':
        return [
          `${s.learners.total} ${s.learners.total === 1 ? 'learner' : 'learners'}`,
          ...(s.learners.suspended ? [`${s.learners.suspended} suspended`] : [])
        ];
      case 'tutors':
        return [`${s.tutors.total} ${s.tutors.total === 1 ? 'tutor' : 'tutors'}`];
      case 'admins':
        return [`${s.admins.total} ${s.admins.total === 1 ? 'admin' : 'admins'}`];
      case 'courses':
        return [`${s.courses.published} published`, `${s.courses.draft} draft`];
      case 'progression':
        return [`${s.learners.total} ${s.learners.total === 1 ? 'learner' : 'learners'}`];
      default:
        return [];
    }
  });
</script>

{#if s}
  <div class="hidden items-center gap-1.5 sm:flex">
    {#each chips as chip (chip)}
      <Badge variant="secondary" class="font-normal tabular-nums">{chip}</Badge>
    {/each}
    <span
      class="text-muted-foreground ml-0.5 inline-flex items-center gap-1.5 text-xs tabular-nums"
      title="Signed in and active in the last 5 minutes"
    >
      <span class="relative flex size-2">
        <span
          class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
          class:hidden={s.online === 0}
        ></span>
        <span
          class="relative inline-flex size-2 rounded-full {s.online > 0 ? 'bg-emerald-500' : 'bg-muted-foreground/40'}"
        ></span>
      </span>
      {s.online} online
    </span>
  </div>
{/if}
