<script lang="ts">
  import { page } from '$app/state';
  import { SvelteSet } from 'svelte/reactivity';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { Spinner } from '@cio/ui/base/spinner';
  import * as Table from '@cio/ui/base/table';
  import * as Select from '@cio/ui/base/select';
  import * as Avatar from '@cio/ui/base/avatar';
  import { Search } from '@cio/ui/custom/search';
  import { Empty } from '@cio/ui/custom/empty';
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import UsersRoundIcon from '@lucide/svelte/icons/users-round';
  import FileIcon from '@lucide/svelte/icons/file';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import { RESULT_LABELS, isPassingResult } from '@cio/utils/constants';
  import {
    caseloadApi,
    type SubmissionsGridRow
  } from '$features/caseload/api/caseload.svelte';
  import GradingDrawer from '$features/caseload/components/grading-drawer.svelte';

  // Moodle-style tutor submissions grid (PearlLMS — courses-assigned phase). One dense, scrollable
  // marking table for a single assessment on a unit. lessonId + assessmentKey come from the query
  // string; the grid data is allocation-scoped server-side. Search / status filter are client-side.

  let { data }: { data: { courseId: string } } = $props();

  const lessonId = $derived(page.url.searchParams.get('lessonId') ?? '');
  const assessmentKey = $derived(page.url.searchParams.get('assessmentKey') ?? '');

  // (Re)load whenever the target assessment changes.
  $effect(() => {
    const lid = lessonId;
    const key = assessmentKey;
    if (lid && key) caseloadApi.loadSubmissions(data.courseId, lid, key);
  });

  const grid = $derived(caseloadApi.submissionsGrid);
  const rows = $derived(grid?.rows ?? []);

  type StatusFilter = 'all' | SubmissionsGridRow['state'];
  let searchValue = $state('');
  let statusFilter = $state<StatusFilter>('all');
  const expanded = new SvelteSet<string>();

  const STATUS_META: Record<SubmissionsGridRow['state'], { label: string; class: string }> = {
    not_submitted: { label: 'No submission', class: 'bg-muted text-muted-foreground' },
    draft: { label: 'Draft', class: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' },
    draft_feedback: {
      label: 'Draft feedback',
      class: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300'
    },
    awaiting_marking: {
      label: 'Submitted for grading',
      class: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
    },
    referred: { label: 'Referred', class: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
    passed: {
      label: 'Graded / Pass',
      class: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
    }
  };
  const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
    all: 'All statuses',
    not_submitted: 'Not submitted',
    draft: 'Draft',
    awaiting_marking: 'Awaiting marking',
    draft_feedback: 'Draft feedback',
    referred: 'Referred',
    passed: 'Passed'
  };

  const filteredRows = $derived.by(() => {
    const q = searchValue.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.state !== statusFilter) return false;
      if (q) {
        const hay = [r.learner.name, r.learner.email, r.learner.username, r.learner.idNumber]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  function initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  }
  function formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
  }
  function formatDateTime(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? '—'
      : d.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function gradeLabel(grade: string | null): string {
    if (!grade) return '—';
    return RESULT_LABELS[grade as keyof typeof RESULT_LABELS] ?? grade;
  }

  // The submission to grade for a row: an explicit target, else the latest version.
  function latestVersionId(row: SubmissionsGridRow): string | null {
    if (row.versions.length === 0) return null;
    return row.versions.reduce((a, b) => (b.version >= a.version ? b : a)).submissionId;
  }
  function gradeTarget(row: SubmissionsGridRow): string | null {
    return row.gradeTargetId ?? latestVersionId(row);
  }

  function toggleRow(learnerId: string) {
    if (expanded.has(learnerId)) expanded.delete(learnerId);
    else expanded.add(learnerId);
  }

  function openFile(key: string) {
    caseloadApi.openFile(data.courseId, lessonId, key);
  }

  let downloadingAll = $state(false);
  async function downloadAll() {
    if (!lessonId || !assessmentKey) return;
    downloadingAll = true;
    try {
      await caseloadApi.downloadAllSubmissions(data.courseId, lessonId, assessmentKey);
    } finally {
      downloadingAll = false;
    }
  }

  // ── Grading drawer state ──
  let drawerOpen = $state(false);
  let drawerRow = $state<SubmissionsGridRow | null>(null);
  let drawerSubmissionId = $state<string | null>(null);

  function openGrade(row: SubmissionsGridRow) {
    const target = gradeTarget(row);
    if (!target) return;
    drawerRow = row;
    drawerSubmissionId = target;
    drawerOpen = true;
  }
  function onGraded() {
    if (lessonId && assessmentKey) caseloadApi.loadSubmissions(data.courseId, lessonId, assessmentKey);
  }

  const stickyHead = 'ui:sticky ui:left-0 ui:z-20 ui:bg-card';
  const stickyCell = 'ui:sticky ui:left-0 ui:z-10 ui:bg-card';
</script>

<svelte:head>
  <title>{grid?.assessmentName ?? 'Submissions'} — Pearl LMS</title>
</svelte:head>

<div class="mb-4">
  <a
    href={`/caseload/courses/${data.courseId}`}
    class="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
  >
    <ArrowLeftIcon size={16} /> Course
  </a>
  {#if grid}
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-2xl font-semibold tracking-tight">{grid.assessmentName}</h1>
      <Badge variant="secondary" class="capitalize">{grid.kind}</Badge>
    </div>
    <p class="text-muted-foreground mt-1 text-sm">
      {grid.unitTitle}
      {#if grid.dueAt}· Due {formatDate(grid.dueAt)}{/if}
    </p>
  {/if}
</div>

{#if !grid}
  <div class="flex justify-center py-16"><Spinner /></div>
{:else if grid.summary.participants === 0}
  <Empty
    title="No learners"
    description="No learners assigned to you on this course."
    icon={UsersRoundIcon}
    variant="page"
  />
{:else}
  <!-- Grading summary bar -->
  <div class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
    {#each [{ label: 'Participants', value: String(grid.summary.participants) }, { label: 'Submitted', value: String(grid.summary.submitted) }, { label: 'Needs grading', value: String(grid.summary.needsGrading) }, { label: 'Passed', value: String(grid.summary.passed) }, { label: 'Referred', value: String(grid.summary.referred) }, { label: 'Due date', value: formatDate(grid.summary.dueAt) }] as tile (tile.label)}
      <div class="bg-card rounded-lg border p-3">
        <p class="text-muted-foreground text-xs">{tile.label}</p>
        <p class="mt-0.5 text-lg font-semibold tabular-nums">{tile.value}</p>
      </div>
    {/each}
  </div>

  <!-- Toolbar -->
  <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <Search placeholder="Search name, email, username, ID" bind:value={searchValue} />
      <Select.Root type="single" bind:value={statusFilter}>
        <Select.Trigger class="min-w-[160px]">
          <p>{STATUS_FILTER_LABELS[statusFilter]}</p>
        </Select.Trigger>
        <Select.Content>
          {#each Object.keys(STATUS_FILTER_LABELS) as key (key)}
            <Select.Item value={key}>{STATUS_FILTER_LABELS[key as StatusFilter]}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
    <div class="flex items-center gap-3">
      <span class="text-muted-foreground text-sm tabular-nums">
        {filteredRows.length} of {rows.length}
      </span>
      <Button
        variant="outline"
        size="sm"
        loading={downloadingAll}
        disabled={downloadingAll || (grid?.summary.submitted ?? 0) === 0}
        onclick={downloadAll}
        title="Download every learner's latest submission as a zip"
      >
        <DownloadIcon size={16} class="mr-1" /> Download all
      </Button>
    </div>
  </div>

  <!-- The grid: vertical scroll on the wrapper, horizontal scroll inside the table container. -->
  <div class="max-h-[70vh] overflow-y-auto rounded-md border">
    <Table.Root class="ui:min-w-max">
      <Table.Header class="ui:sticky ui:top-0 ui:z-30 ui:bg-card ui:[&_th]:bg-card">
        <Table.Row>
          <Table.Head class="ui:w-8"></Table.Head>
          <Table.Head class={stickyHead}>Name</Table.Head>
          <Table.Head>Username</Table.Head>
          <Table.Head>ID number</Table.Head>
          <Table.Head>Email</Table.Head>
          <Table.Head>Status</Table.Head>
          <Table.Head>Allow submissions from</Table.Head>
          <Table.Head>Due date</Table.Head>
          <Table.Head>Grade</Table.Head>
          <Table.Head>Last modified (submission)</Table.Head>
          <Table.Head>File submissions</Table.Head>
          <Table.Head>Submission comments</Table.Head>
          <Table.Head>Last modified (grade)</Table.Head>
          <Table.Head>Feedback files</Table.Head>
          <Table.Head>Feedback comments</Table.Head>
          <Table.Head>Final grade</Table.Head>
          <Table.Head>Actions</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#if filteredRows.length === 0}
          <Table.Row>
            <Table.Cell colspan={17} class="text-muted-foreground py-10 text-center">
              No learners match the current filters.
            </Table.Cell>
          </Table.Row>
        {:else}
          {#each filteredRows as row (row.learner.learnerId)}
            {@const meta = STATUS_META[row.state]}
            {@const isOpen = expanded.has(row.learner.learnerId)}
            {@const target = gradeTarget(row)}
            <Table.Row>
              <Table.Cell class="ui:w-8">
                {#if row.versionCount > 0}
                  <button
                    type="button"
                    class="hover:bg-muted flex size-6 items-center justify-center rounded"
                    aria-label={isOpen ? 'Collapse history' : 'Expand history'}
                    onclick={() => toggleRow(row.learner.learnerId)}
                  >
                    {#if isOpen}
                      <ChevronDownIcon size={16} />
                    {:else}
                      <ChevronRightIcon size={16} />
                    {/if}
                  </button>
                {/if}
              </Table.Cell>
              <Table.Cell class={`${stickyCell} ui:font-medium`}>
                <div class="flex items-center gap-2">
                  <Avatar.Root class="ui:size-7 ui:shrink-0">
                    {#if row.learner.avatarUrl}
                      <Avatar.Image src={row.learner.avatarUrl} alt={row.learner.name} />
                    {/if}
                    <Avatar.Fallback class="ui:text-xs">{initials(row.learner.name)}</Avatar.Fallback>
                  </Avatar.Root>
                  <span class="truncate">{row.learner.name}</span>
                </div>
              </Table.Cell>
              <Table.Cell>{row.learner.username}</Table.Cell>
              <Table.Cell>{row.learner.idNumber ?? '—'}</Table.Cell>
              <Table.Cell>{row.learner.email ?? '—'}</Table.Cell>
              <Table.Cell>
                <span class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${meta.class}`}>
                  {meta.label}
                </span>
              </Table.Cell>
              <Table.Cell class="tabular-nums">{formatDate(row.learner.enrolledAt)}</Table.Cell>
              <Table.Cell class="tabular-nums">{formatDate(grid.summary.dueAt)}</Table.Cell>
              <Table.Cell>
                {#if row.grade}
                  <span class={isPassingResult(row.grade) ? 'ui:text-emerald-600 ui:dark:text-emerald-400 font-medium' : 'ui:text-red-600 ui:dark:text-red-400 font-medium'}>
                    {gradeLabel(row.grade)}
                  </span>
                {:else}
                  <span class="text-muted-foreground">—</span>
                {/if}
              </Table.Cell>
              <Table.Cell class="tabular-nums">{formatDateTime(row.latestSubmittedAt)}</Table.Cell>
              <Table.Cell>
                {#if row.files.length > 0}
                  <div class="flex flex-col gap-0.5">
                    {#each row.files as file (file.key)}
                      <button
                        type="button"
                        class="ui:text-primary inline-flex items-center gap-1 text-left text-sm hover:underline"
                        onclick={() => openFile(file.key)}
                      >
                        <FileIcon size={13} class="shrink-0" />
                        <span class="max-w-[180px] truncate">{file.name}</span>
                      </button>
                    {/each}
                  </div>
                {:else}
                  <span class="text-muted-foreground">—</span>
                {/if}
              </Table.Cell>
              <Table.Cell>
                {#if row.comment}
                  <span class="block max-w-[200px] truncate" title={row.comment}>{row.comment}</span>
                {:else}
                  <span class="text-muted-foreground">—</span>
                {/if}
              </Table.Cell>
              <Table.Cell class="tabular-nums">{formatDateTime(row.lastModifiedGrade)}</Table.Cell>
              <Table.Cell>
                {#if row.feedbackFiles.length > 0}
                  <div class="flex flex-col gap-0.5">
                    {#each row.feedbackFiles as file (file.key)}
                      <button
                        type="button"
                        class="ui:text-primary inline-flex items-center gap-1 text-left text-sm hover:underline"
                        onclick={() => openFile(file.key)}
                      >
                        <FileIcon size={13} class="shrink-0" />
                        <span class="max-w-[180px] truncate">{file.name}</span>
                      </button>
                    {/each}
                  </div>
                {:else}
                  <span class="text-muted-foreground">—</span>
                {/if}
              </Table.Cell>
              <Table.Cell>
                {#if row.feedback}
                  <span class="block max-w-[200px] truncate" title={row.feedback}>{row.feedback}</span>
                {:else}
                  <span class="text-muted-foreground">—</span>
                {/if}
              </Table.Cell>
              <Table.Cell>
                {#if row.grade}
                  <span class={isPassingResult(row.grade) ? 'ui:text-emerald-600 ui:dark:text-emerald-400 font-medium' : 'ui:text-red-600 ui:dark:text-red-400 font-medium'}>
                    {gradeLabel(row.grade)}
                  </span>
                {:else}
                  <span class="text-muted-foreground">—</span>
                {/if}
              </Table.Cell>
              <Table.Cell>
                <div class="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" disabled={!target} onclick={() => openGrade(row)}>
                    Grade
                  </Button>
                  {#if row.versionCount > 0}
                    <Button size="sm" variant="ghost" onclick={() => toggleRow(row.learner.learnerId)}>
                      History ({row.versionCount})
                    </Button>
                  {/if}
                </div>
              </Table.Cell>
            </Table.Row>

            {#if isOpen}
              <Table.Row>
                <Table.Cell colspan={17} class="bg-muted/30 p-3">
                  {#if row.versions.length === 0}
                    <p class="text-muted-foreground text-sm">No submission history.</p>
                  {:else}
                    <div class="space-y-2">
                      {#each row.versions as v (v.submissionId)}
                        <div class="bg-background flex flex-col gap-2 rounded-md border p-2.5 text-sm md:flex-row md:items-start md:justify-between">
                          <div class="space-y-1">
                            <div class="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">v{v.version}</Badge>
                              <Badge variant="secondary" class="capitalize">{v.submissionType}</Badge>
                              <span class="text-muted-foreground tabular-nums">{formatDateTime(v.submittedAt)}</span>
                              {#if v.result}
                                <span class={isPassingResult(v.result) ? 'ui:text-emerald-600 ui:dark:text-emerald-400 font-medium' : 'ui:text-red-600 ui:dark:text-red-400 font-medium'}>
                                  {gradeLabel(v.result)}
                                </span>
                              {/if}
                            </div>
                            {#if v.files.length > 0}
                              <div class="flex flex-wrap gap-x-3 gap-y-0.5">
                                {#each v.files as file (file.key)}
                                  <button
                                    type="button"
                                    class="ui:text-primary inline-flex items-center gap-1 hover:underline"
                                    onclick={() => openFile(file.key)}
                                  >
                                    <FileIcon size={13} />{file.name}
                                  </button>
                                {/each}
                              </div>
                            {/if}
                            {#if v.feedback}
                              <p class="text-muted-foreground">Feedback: {v.feedback}</p>
                            {/if}
                            {#if v.feedbackFiles.length > 0}
                              <div class="flex flex-wrap gap-x-3 gap-y-0.5">
                                {#each v.feedbackFiles as file (file.key)}
                                  <button
                                    type="button"
                                    class="ui:text-primary inline-flex items-center gap-1 hover:underline"
                                    onclick={() => openFile(file.key)}
                                  >
                                    <FileIcon size={13} />{file.name}
                                  </button>
                                {/each}
                              </div>
                            {/if}
                          </div>
                          <div class="text-muted-foreground shrink-0 text-xs">
                            {#if v.gradedByName}Graded by {v.gradedByName}{/if}
                            {#if v.recordedAt}<span class="tabular-nums"> · {formatDateTime(v.recordedAt)}</span>{/if}
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </Table.Cell>
              </Table.Row>
            {/if}
          {/each}
        {/if}
      </Table.Body>
    </Table.Root>
  </div>
{/if}

<GradingDrawer
  bind:open={drawerOpen}
  row={drawerRow}
  courseId={data.courseId}
  {lessonId}
  submissionId={drawerSubmissionId}
  allowDrafts={grid?.allowDrafts ?? false}
  {onGraded}
/>
