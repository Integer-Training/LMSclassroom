<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { Button } from '@cio/ui/base/button';
  import MessageSquareIcon from '@lucide/svelte/icons/message-square';
  import { Badge } from '@cio/ui/base/badge';
  import * as Table from '@cio/ui/base/table';
  import { Input } from '@cio/ui/base/input';
  import UsersIcon from '@lucide/svelte/icons/users';
  import { caseloadApi, type PipelineItem } from '$features/caseload/api/caseload.svelte';
  import ActivityPie from '$features/caseload/components/activity-pie.svelte';
  import OutcomesDonut from '$features/caseload/components/outcomes-donut.svelte';
  import { announcementsApi } from '$features/announcements/api/announcements.svelte';
  import AnnouncementsList from '$features/announcements/components/announcements-list.svelte';
  import BroadcastBanner from '$features/announcements/components/broadcast-banner.svelte';
  import { profile } from '$lib/utils/store/user';
  import { currentOrg } from '$lib/utils/store/org';
  import { snackbar } from '$features/ui/snackbar/store';
  import { messagingApi } from '$features/messaging/api/messaging.svelte';
  import EmailContact from '$features/messaging/components/email-contact.svelte';

  // Message is TUTOR-only (the API refuses Admin/Manager); Email is shown to whoever already sees the row.
  const canMessage = $derived(($page.data.locals?.actor as { role?: string } | undefined)?.role === 'TUTOR');
  let messagingId = $state<string | null>(null);
  async function messageLearner(learnerId: string) {
    if (messagingId) return;
    messagingId = learnerId;
    try {
      const res = await messagingApi.startConversation(learnerId);
      if (!res) return;
      if ('error' in res) {
        snackbar.error(res.error);
        return;
      }
      await goto(`/messages/${res.threadId}`);
    } finally {
      messagingId = null;
    }
  }
  const emailSubject = (learnerName: string | null) => [$currentOrg.name, learnerName].filter(Boolean).join(' — ');

  const firstName = $derived($profile.fullname?.trim().split(/\s+/)[0] || '');

  // Tutor dashboard (PearlLMS Phase 8) — a rich caseload overview: KPI tiles, activity/outcome charts,
  // the grading pipeline + programmes tables, and per-queue drill-downs. Allocation-scoped server-side
  // (a tutor sees only their learners; Admin sees the org).

  type QueueView = 'awaiting' | 'resubmissions' | 'drafts' | 'overdue' | 'dueSoon' | 'learners';
  let activeView = $state<QueueView | null>(null);

  // The pipeline carries the tiles/tables; the "Your learners" roster (always visible, with View / Message / Email per
  // learner) loads the caseload list alongside it. Its own loading flag — the API object's isLoading is shared with
  // the pipeline load. BroadcastBanner (rendered below) owns the announcements feed load.
  let rosterLoading = $state(true);
  let rosterFilter = $state('');
  let rosterEl = $state<HTMLElement | null>(null);
  onMount(() => {
    caseloadApi.loadPipeline();
    caseloadApi.loadCaseload().finally(() => (rosterLoading = false));
  });

  const filteredLearners = $derived.by(() => {
    const q = rosterFilter.trim().toLowerCase();
    if (!q) return caseloadApi.learners;
    return caseloadApi.learners.filter(
      (l) => (l.name ?? '').toLowerCase().includes(q) || (l.email ?? '').toLowerCase().includes(q)
    );
  });

  function scrollToRoster() {
    const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    rosterEl?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

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
    // The learner roster is always on the page now — a "learners" tile just jumps to it.
    if (view === 'learners') return scrollToRoster();
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
    {
      label: 'Resubmissions Awaiting Review',
      count: stats?.resubmissions ?? 0,
      view: 'resubmissions' as QueueView | null
    },
    { label: 'Overdue (>72h)', count: stats?.overdue ?? 0, view: 'overdue' as QueueView | null },
    { label: 'Due Within 3 Days', count: stats?.dueSoon ?? 0, view: 'dueSoon' as QueueView | null },
    { label: 'Total Graded', count: stats?.totalGraded ?? 0, view: null },
    { label: 'Awaiting Draft Feedback', count: stats?.awaitingDraftFeedback ?? 0, view: 'drafts' as QueueView | null }
  ]);

  const secondaryTiles = $derived([
    { label: 'Overdue', value: stats?.overdue ?? 0, view: 'overdue' as QueueView, tone: 'amber' },
    { label: 'Due Within 3 Days', value: stats?.dueSoon ?? 0, view: 'dueSoon' as QueueView, tone: 'amber' },
    {
      label: 'Inactive Learners 30+ days',
      value: stats?.inactiveLearners ?? 0,
      view: 'learners' as QueueView,
      tone: 'muted'
    },
    {
      label: 'Awaiting Draft Feedback',
      value: stats?.awaitingDraftFeedback ?? 0,
      view: 'drafts' as QueueView,
      tone: 'muted'
    },
    {
      label: 'Learners With Pending Work',
      value: stats?.learnersWithPendingWork ?? 0,
      view: 'learners' as QueueView,
      tone: 'muted'
    }
  ]);
</script>

<BroadcastBanner />

<div class="mb-6">
  <h1 class="text-2xl font-semibold tracking-tight">
    {firstName ? `Welcome back, ${firstName}` : 'Tutor Dashboard'}
  </h1>
  <p class="text-muted-foreground text-sm">Your caseload overview · Grading pipeline</p>
</div>

<!-- Broadcasts from admin (tutor-addressed only) -->
{#if announcementsApi.items.length}
  <div class="mb-6">
    <h2 class="mb-2 text-lg font-semibold tracking-tight">Announcements</h2>
    <AnnouncementsList items={announcementsApi.items} showScope={false} />
  </div>
{/if}

<!-- Primary KPI tiles -->
<div class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
  <!-- Your Learners (click → the roster below) -->
  <button
    type="button"
    onclick={scrollToRoster}
    class="bg-card hover:bg-muted/40 rounded-xl border p-4 text-left transition-colors"
    aria-label="Your learners — show the list"
  >
    <p class="text-muted-foreground flex items-center justify-between text-xs font-medium">
      Your Learners <span class="text-primary">View list ↓</span>
    </p>
    <p class="mt-1 text-3xl font-semibold">{stats?.learners ?? caseloadApi.learners.length}</p>
    <div class="mt-2 flex flex-wrap gap-1">
      <Badge variant="secondary" class="text-emerald-600 dark:text-emerald-400"
        >{stats?.activeLearners ?? 0} Active</Badge
      >
      <Badge variant="secondary">{stats?.inactiveLearners ?? 0} Inactive</Badge>
      <Badge variant="secondary">{stats?.neverLoggedIn ?? 0} Never in</Badge>
    </div>
  </button>

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
    <p class="mt-1 text-3xl font-semibold">
      {stats?.totalGraded ?? 0} <span class="text-muted-foreground text-base font-normal">graded</span>
    </p>
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

<!-- Your learners — always visible: View / Message / Email per learner -->
<section class="mb-6 scroll-mt-4" bind:this={rosterEl} aria-labelledby="roster-heading">
  <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
    <h2 id="roster-heading" class="text-lg font-semibold tracking-tight">
      Your learners
      {#if caseloadApi.learners.length}<span class="text-muted-foreground text-sm font-normal"
          >({caseloadApi.learners.length})</span
        >{/if}
    </h2>
    {#if caseloadApi.learners.length > 6}
      <Input
        type="search"
        placeholder="Search by name or email"
        aria-label="Search your learners"
        class="h-8 w-full sm:w-64"
        bind:value={rosterFilter}
      />
    {/if}
  </div>

  {#if rosterLoading && caseloadApi.learners.length === 0}
    <div class="text-muted-foreground rounded-md border p-8 text-center text-sm">Loading…</div>
  {:else if caseloadApi.learners.length === 0}
    <div class="rounded-md border p-8 text-center">
      <UsersIcon class="text-muted-foreground mx-auto mb-3 size-6" />
      <p class="font-medium">No learners are allocated to you yet</p>
      <p class="text-muted-foreground mt-1 text-sm">Your manager assigns learners to you. They appear here.</p>
    </div>
  {:else if filteredLearners.length === 0}
    <div class="text-muted-foreground rounded-md border p-8 text-center text-sm">
      No learners match “{rosterFilter.trim()}”.
    </div>
  {:else}
    <div class="overflow-x-auto rounded-md border">
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Learner</Table.Head>
            <Table.Head class="hidden md:table-cell">Email</Table.Head>
            <Table.Head class="hidden text-right sm:table-cell">Submissions</Table.Head>
            <Table.Head class="text-right">Actions</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each filteredLearners as learner (learner.learnerId)}
            <Table.Row>
              <Table.Cell class="font-medium whitespace-normal!">
                <a href={`/caseload/${learner.learnerId}`} class="hover:underline">{learner.name || 'Learner'}</a>
              </Table.Cell>
              <Table.Cell class="text-muted-foreground hidden break-all whitespace-normal! md:table-cell"
                >{learner.email ?? ''}</Table.Cell
              >
              <Table.Cell class="hidden text-right sm:table-cell">{learner.submissionCount}</Table.Cell>
              <Table.Cell class="text-right">
                <div class="flex flex-wrap items-center justify-end gap-1.5">
                  <Button href={`/caseload/${learner.learnerId}`} variant="ghost" size="sm">View</Button>
                  {#if canMessage}
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label="Message {learner.name || 'learner'}"
                      loading={messagingId === learner.learnerId}
                      disabled={!!messagingId}
                      onclick={() => messageLearner(learner.learnerId)}
                    >
                      <MessageSquareIcon class="size-4" /> Message
                    </Button>
                  {/if}
                  <EmailContact
                    compact
                    labelled
                    email={learner.email}
                    name={learner.name || 'learner'}
                    subject={emailSubject(learner.name)}
                  />
                </div>
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
  {/if}
</section>

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

    {#if queueItems.length === 0}
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
