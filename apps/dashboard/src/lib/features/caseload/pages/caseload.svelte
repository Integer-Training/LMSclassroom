<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Badge } from '@cio/ui/base/badge';
  import * as Table from '@cio/ui/base/table';
  import UsersIcon from '@lucide/svelte/icons/users';
  import { caseloadApi, type PipelineItem } from '$features/caseload/api/caseload.svelte';
  import ActivityPie from '$features/caseload/components/activity-pie.svelte';
  import OutcomesDonut from '$features/caseload/components/outcomes-donut.svelte';

  // Tutor dashboard (PearlLMS Phase 8) — a rich caseload overview: KPI tiles, activity/outcome charts,
  // the grading pipeline + programmes tables, and per-queue drill-downs. Allocation-scoped server-side
  // (a tutor sees only their learners; Admin sees the org).

  type QueueView = 'awaiting' | 'resubmissions' | 'drafts' | 'overdue' | 'dueSoon' | 'learners';
  let activeView = $state<QueueView | null>(null);

  onMount(() => {
    caseloadApi.loadCaseload();
    caseloadApi.loadPipeline();
  });

  const stats = $derived(caseloadApi.pipeline?.stats ?? null);
  const programmes = $derived(caseloadApi.pipeline?.programmes ?? []);
  const passRate = $derived(
    stats && stats.passCount + stats.referCount > 0
      ? Math.round((stats.passCount / (stats.passCount + stats.referCount)) * 100)
      : null
  );

  const queueItems = $derived.by((): PipelineItem[] => {
    const p = caseloadApi.pipeline;
    if (!p || !activeView) return [];
    switch (activeView) {
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

  const QUEUE_META: Record<QueueView, { label: string; empty: string }> = {
    awaiting: { label: 'Awaiting Marking', empty: 'Nothing awaiting marking. You are all caught up.' },
    resubmissions: { label: 'Resubmissions Awaiting Review', empty: 'No resubmissions awaiting review.' },
    drafts: { label: 'Awaiting Draft Feedback', empty: 'No drafts awaiting feedback.' },
    overdue: { label: 'Overdue', empty: 'Nothing overdue. Great turnaround.' },
    dueSoon: { label: 'Due Within 3 Days', empty: 'Nothing due in the next 3 days.' },
    learners: { label: 'Your Learners', empty: 'No learners are allocated to you yet.' }
  };

  // Ref to the drill-down section so a "View"/tile click scrolls it into sight (user-friendly — the
  // section renders below the tables, so opening it silently would leave it off-screen).
  let drilldownEl = $state<HTMLElement | null>(null);

  async function open(view: QueueView) {
    const wasActive = activeView === view;
    activeView = wasActive ? null : view;
    if (wasActive) return; // toggled off — nothing to scroll to
    await tick(); // wait for the drill-down to render
    const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    drilldownEl?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

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

  const pipelineRows = $derived([
    { label: 'Awaiting Marking', count: stats?.awaitingMarking ?? 0, view: 'awaiting' as QueueView | null },
    { label: 'Resubmissions Awaiting Review', count: stats?.resubmissions ?? 0, view: 'resubmissions' as QueueView | null },
    { label: 'Overdue (>72h)', count: stats?.overdue ?? 0, view: 'overdue' as QueueView | null },
    { label: 'Due Within 3 Days', count: stats?.dueSoon ?? 0, view: 'dueSoon' as QueueView | null },
    { label: 'Total Graded', count: stats?.totalGraded ?? 0, view: null },
    { label: 'Awaiting Draft Feedback', count: stats?.awaitingDraftFeedback ?? 0, view: 'drafts' as QueueView | null }
  ]);

  const secondaryTiles = $derived([
    { label: 'Overdue', value: stats?.overdue ?? 0, view: 'overdue' as QueueView, tone: 'amber' },
    { label: 'Due Within 3 Days', value: stats?.dueSoon ?? 0, view: 'dueSoon' as QueueView, tone: 'amber' },
    { label: 'Inactive Learners 30+ days', value: stats?.inactiveLearners ?? 0, view: 'learners' as QueueView, tone: 'muted' },
    { label: 'Awaiting Draft Feedback', value: stats?.awaitingDraftFeedback ?? 0, view: 'drafts' as QueueView, tone: 'muted' },
    { label: 'Learners With Pending Work', value: stats?.learnersWithPendingWork ?? 0, view: 'learners' as QueueView, tone: 'muted' }
  ]);
</script>

<div class="mb-6">
  <h1 class="text-2xl font-semibold tracking-tight">Tutor Dashboard</h1>
  <p class="text-muted-foreground text-sm">Your caseload overview · Grading pipeline</p>
</div>

<!-- Primary KPI tiles -->
<div class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
  <!-- Your Learners -->
  <div class="bg-card rounded-xl border p-4">
    <p class="text-muted-foreground text-xs font-medium">Your Learners</p>
    <p class="mt-1 text-3xl font-semibold">{stats?.learners ?? caseloadApi.learners.length}</p>
    <div class="mt-2 flex flex-wrap gap-1">
      <Badge variant="secondary" class="text-emerald-600 dark:text-emerald-400">{stats?.activeLearners ?? 0} Active</Badge>
      <Badge variant="secondary">{stats?.inactiveLearners ?? 0} Inactive</Badge>
      <Badge variant="secondary">{stats?.neverLoggedIn ?? 0} Never in</Badge>
    </div>
  </div>

  <!-- Courses -->
  <div class="bg-card rounded-xl border p-4">
    <p class="text-muted-foreground text-xs font-medium">Courses</p>
    <p class="mt-1 text-3xl font-semibold">{stats?.courses ?? 0}</p>
    <p class="text-muted-foreground mt-2 text-sm">{stats?.assignments ?? 0} Assignments</p>
  </div>

  <!-- Awaiting Marking -->
  <div class="bg-card rounded-xl border p-4">
    <p class="text-muted-foreground text-xs font-medium">Awaiting Marking</p>
    <p class="mt-1 text-3xl font-semibold text-amber-600 dark:text-amber-400">{stats?.awaitingMarking ?? 0}</p>
    <p class="text-muted-foreground mt-2 text-sm">{stats?.resubmissions ?? 0} Resubmissions</p>
  </div>

  <!-- Grading Stats -->
  <div class="bg-card rounded-xl border p-4">
    <p class="text-muted-foreground text-xs font-medium">Grading Stats</p>
    <p class="mt-1 text-3xl font-semibold">{stats?.totalGraded ?? 0} <span class="text-muted-foreground text-base font-normal">graded</span></p>
    <div class="mt-2 flex flex-wrap gap-1">
      {#if passRate !== null}
        <Badge variant="secondary" class="text-emerald-600 dark:text-emerald-400">{passRate}% Pass Rate</Badge>
      {/if}
      {#if stats?.avgTurnaroundDays != null}
        <Badge variant="secondary">{stats.avgTurnaroundDays}d Avg Turn.</Badge>
      {/if}
    </div>
  </div>
</div>

<!-- Secondary clickable tiles -->
<div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
  {#each secondaryTiles as tile (tile.label)}
    <button
      type="button"
      onclick={() => open(tile.view)}
      class={`rounded-lg border p-3 text-left transition-colors ${
        activeView === tile.view ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
      }`}
    >
      <p class={`text-2xl font-semibold ${tile.tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : ''}`}>
        {tile.value}
      </p>
      <p class="text-muted-foreground text-xs">{tile.label}</p>
    </button>
  {/each}
</div>

<!-- Charts -->
{#if stats}
  <div class="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
    <ActivityPie
      active={stats.activeLearners}
      inactive={stats.inactiveLearners}
      neverLoggedIn={stats.neverLoggedIn}
      suspended={stats.suspendedLearners}
    />
    <OutcomesDonut passCount={stats.passCount} referCount={stats.referCount} {passRate} />
  </div>
{/if}

<!-- Grading Pipeline table -->
<div class="mb-6">
  <h2 class="mb-2 text-lg font-semibold tracking-tight">Grading Pipeline</h2>
  <div class="overflow-x-auto rounded-md border">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>Metric</Table.Head>
          <Table.Head class="w-24 text-right">Count</Table.Head>
          <Table.Head class="w-24 text-right">Action</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each pipelineRows as row (row.label)}
          <Table.Row>
            <Table.Cell class="font-medium">{row.label}</Table.Cell>
            <Table.Cell class="text-right">{row.count}</Table.Cell>
            <Table.Cell class="text-right">
              {#if row.view}
                <button type="button" class="text-primary text-sm hover:underline" onclick={() => open(row.view!)}>
                  View
                </button>
              {:else}
                <span class="text-muted-foreground text-sm">—</span>
              {/if}
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
</div>

<!-- Programmes & Caseload table -->
<div class="mb-6">
  <h2 class="mb-2 text-lg font-semibold tracking-tight">Programmes &amp; Caseload</h2>
  <div class="overflow-x-auto rounded-md border">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>Programme</Table.Head>
          <Table.Head class="w-28 text-right">Learners</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#if programmes.length === 0}
          <Table.Row>
            <Table.Cell colspan={2} class="text-muted-foreground text-center text-sm">
              {caseloadApi.isLoading ? 'Loading…' : 'No programmes yet.'}
            </Table.Cell>
          </Table.Row>
        {:else}
          {#each programmes as prog (prog.courseId)}
            <Table.Row>
              <Table.Cell class="font-medium">{prog.title}</Table.Cell>
              <Table.Cell class="text-right">{prog.learners}</Table.Cell>
            </Table.Row>
          {/each}
        {/if}
      </Table.Body>
    </Table.Root>
  </div>
</div>

<!-- Drill-down: queue or roster -->
{#if activeView}
  <div class="mb-6 scroll-mt-4" bind:this={drilldownEl}>
    <div class="mb-2 flex items-center justify-between">
      <h2 class="text-lg font-semibold tracking-tight">{QUEUE_META[activeView].label}</h2>
      <button type="button" class="text-muted-foreground text-sm hover:underline" onclick={() => (activeView = null)}>
        Hide
      </button>
    </div>

    {#if activeView === 'learners'}
      {#if caseloadApi.learners.length === 0}
        <div class="rounded-md border p-8 text-center">
          <UsersIcon class="text-muted-foreground mx-auto mb-3 size-6" />
          <p class="font-medium">No learners are allocated to you yet</p>
          <p class="text-muted-foreground mt-1 text-sm">Your manager assigns learners to you. They appear here.</p>
        </div>
      {:else}
        <div class="overflow-x-auto rounded-md border">
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>Learner</Table.Head>
                <Table.Head>Email</Table.Head>
                <Table.Head class="text-right">Submissions</Table.Head>
                <Table.Head class="w-20 text-right">Action</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each caseloadApi.learners as learner (learner.learnerId)}
                <Table.Row>
                  <Table.Cell class="font-medium">{learner.name || 'Learner'}</Table.Cell>
                  <Table.Cell class="text-muted-foreground">{learner.email ?? ''}</Table.Cell>
                  <Table.Cell class="text-right">{learner.submissionCount}</Table.Cell>
                  <Table.Cell class="text-right">
                    <a href={`/caseload/${learner.learnerId}`} class="text-primary text-sm hover:underline">View</a>
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </div>
      {/if}
    {:else if queueItems.length === 0}
      <div class="text-muted-foreground rounded-md border p-8 text-center text-sm">
        {caseloadApi.isLoading ? 'Loading…' : QUEUE_META[activeView].empty}
      </div>
    {:else}
      <div class="overflow-x-auto rounded-md border">
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>Learner</Table.Head>
              <Table.Head>Course</Table.Head>
              <Table.Head>Assignment</Table.Head>
              <Table.Head>Submitted</Table.Head>
              <Table.Head>Status</Table.Head>
              <Table.Head class="w-20 text-right">Action</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each queueItems as item (item.submissionId)}
              <Table.Row>
                <Table.Cell class="font-medium">{item.learnerName || 'Learner'}</Table.Cell>
                <Table.Cell class="text-muted-foreground">{item.courseTitle}</Table.Cell>
                <Table.Cell>
                  <span class="block">{item.assessmentName}</span>
                  <span class="text-muted-foreground text-xs">{item.unitTitle} · v{item.version}</span>
                </Table.Cell>
                <Table.Cell class="whitespace-nowrap">
                  {formatDate(item.submittedAt)}
                  <span class="text-muted-foreground text-xs">· {waitingDays(item.submittedAt)}d</span>
                </Table.Cell>
                <Table.Cell>
                  <Badge variant="outline">{item.submissionType === 'draft' ? 'Draft' : 'Final'}</Badge>
                </Table.Cell>
                <Table.Cell class="text-right">
                  <a href={`/caseload/${item.learnerId}`} class="text-primary text-sm hover:underline">View</a>
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </div>
    {/if}
  </div>
{/if}
