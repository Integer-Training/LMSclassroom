<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '@cio/ui/base/button';
  import { Badge } from '@cio/ui/base/badge';
  import UsersIcon from '@lucide/svelte/icons/users';
  import { caseloadApi, type PipelineItem } from '$features/caseload/api/caseload.svelte';

  // Tutor grading pipeline (PearlLMS Phase 8) — headline stats + the marking queues, plus the full
  // learner roster. Allocation-scoped server-side (a tutor sees only their learners; Admin sees the org).

  type QueueView = 'awaiting' | 'resubmissions' | 'drafts' | 'overdue' | 'dueSoon' | 'learners';
  let view = $state<QueueView>('awaiting');

  onMount(() => {
    caseloadApi.loadCaseload();
    caseloadApi.loadPipeline();
  });

  const stats = $derived(caseloadApi.pipeline?.stats ?? null);
  const passRate = $derived(
    stats && stats.passCount + stats.referCount > 0
      ? Math.round((stats.passCount / (stats.passCount + stats.referCount)) * 100)
      : null
  );
  const currentQueue = $derived.by((): PipelineItem[] => {
    const p = caseloadApi.pipeline;
    if (!p) return [];
    switch (view) {
      case 'awaiting':
        return p.awaitingMarking;
      case 'resubmissions':
        return p.resubmissions;
      case 'drafts':
        return p.awaitingDraftFeedback;
      case 'overdue':
        return p.overdue;
      case 'dueSoon':
        return p.dueSoon;
      default:
        return [];
    }
  });

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function waitingDays(iso: string): number {
    const ms = Date.now() - new Date(iso).getTime();
    return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
  }
  function dueLabel(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  const tiles = $derived([
    { key: 'awaiting' as QueueView, label: 'Awaiting marking', value: stats?.awaitingMarking ?? 0, clickable: true },
    { key: 'resubmissions' as QueueView, label: 'Resubmissions', value: stats?.resubmissions ?? 0, clickable: true },
    { key: 'drafts' as QueueView, label: 'Awaiting draft feedback', value: stats?.awaitingDraftFeedback ?? 0, clickable: true },
    { key: 'overdue' as QueueView, label: 'Overdue (>SLA)', value: stats?.overdue ?? 0, clickable: true },
    { key: 'dueSoon' as QueueView, label: 'Due within 3 days', value: stats?.dueSoon ?? 0, clickable: true },
    { key: 'learners' as QueueView, label: 'Your learners', value: stats?.learners ?? caseloadApi.learners.length, clickable: true }
  ]);
</script>

{#snippet queueList(items: PipelineItem[], emptyText: string)}
  {#if items.length === 0}
    <div class="text-muted-foreground rounded-md border p-8 text-center text-sm">
      {caseloadApi.isLoading ? 'Loading…' : emptyText}
    </div>
  {:else}
    <ul class="space-y-2">
      {#each items as item (item.submissionId)}
        <li>
          <a
            href={`/caseload/${item.learnerId}`}
            class="hover:bg-muted/40 flex items-center justify-between gap-3 rounded-md border p-3 transition-colors"
          >
            <div class="min-w-0">
              <p class="truncate font-medium">{item.learnerName || 'Learner'}</p>
              <p class="text-muted-foreground truncate text-sm">
                {item.assessmentName} · {item.unitTitle} · {item.courseTitle} · v{item.version}
              </p>
            </div>
            <div class="shrink-0 text-right">
              <Badge variant="outline">{item.submissionType === 'draft' ? 'Draft' : 'Final'}</Badge>
              <p class="text-muted-foreground mt-1 text-xs">
                {#if item.dueAt && view === 'dueSoon'}
                  Due {dueLabel(item.dueAt)}
                {:else}
                  Submitted {formatDate(item.submittedAt)} · {waitingDays(item.submittedAt)}d
                {/if}
              </p>
            </div>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<div class="mx-auto w-full max-w-4xl p-6">
  <div class="mb-6">
    <h1 class="text-xl font-semibold">Grading pipeline</h1>
    <p class="text-muted-foreground text-sm">Your caseload overview and marking queues.</p>
  </div>

  <!-- Headline stats -->
  <div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
    {#each tiles as tile (tile.key)}
      <button
        type="button"
        onclick={() => (view = tile.key)}
        class={`rounded-lg border p-3 text-left transition-colors ${
          view === tile.key ? 'ui:border-primary ui:bg-primary/5' : 'ui:hover:bg-muted/40'
        }`}
      >
        <p class="text-2xl font-semibold">{tile.value}</p>
        <p class="text-muted-foreground text-xs">{tile.label}</p>
      </button>
    {/each}
  </div>

  <!-- Outcome summary -->
  {#if stats}
    <div class="text-muted-foreground mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span><strong class="text-foreground">{stats.totalGraded}</strong> graded</span>
      <span><strong class="text-foreground">{stats.passCount}</strong> Pass</span>
      <span><strong class="text-foreground">{stats.referCount}</strong> Refer</span>
      {#if passRate !== null}<span><strong class="text-foreground">{passRate}%</strong> pass rate</span>{/if}
    </div>
  {/if}

  <!-- Queue / roster views -->
  {#if view === 'learners'}
    {#if caseloadApi.learners.length === 0}
      <div class="rounded-md border p-8 text-center">
        <UsersIcon class="text-muted-foreground mx-auto mb-3 size-6" />
        <p class="font-medium">No learners are allocated to you yet</p>
        <p class="text-muted-foreground mt-1 text-sm">Your manager assigns learners to you. They appear here.</p>
      </div>
    {:else}
      <ul class="space-y-2">
        {#each caseloadApi.learners as learner (learner.learnerId)}
          <li>
            <a
              href={`/caseload/${learner.learnerId}`}
              class="hover:bg-muted/40 flex items-center justify-between gap-3 rounded-md border p-3 transition-colors"
            >
              <div class="min-w-0">
                <p class="truncate font-medium">{learner.name || learner.email || 'Learner'}</p>
                <p class="text-muted-foreground truncate text-sm">{learner.email}</p>
              </div>
              <div class="shrink-0 text-right">
                {#if learner.submissionCount === 0}
                  <span class="text-muted-foreground text-sm">Nothing submitted yet</span>
                {:else}
                  <span class="text-sm">
                    {learner.submissionCount} submission{learner.submissionCount === 1 ? '' : 's'}
                  </span>
                {/if}
              </div>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  {:else if view === 'awaiting'}
    {@render queueList(currentQueue, 'Nothing awaiting marking. You are all caught up.')}
  {:else if view === 'resubmissions'}
    {@render queueList(currentQueue, 'No resubmissions awaiting review.')}
  {:else if view === 'drafts'}
    {@render queueList(currentQueue, 'No drafts awaiting feedback.')}
  {:else if view === 'overdue'}
    {@render queueList(currentQueue, 'Nothing overdue. Great turnaround.')}
  {:else if view === 'dueSoon'}
    {@render queueList(currentQueue, 'Nothing due in the next 3 days.')}
  {/if}
</div>
