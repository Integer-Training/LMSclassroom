<script lang="ts">
  import { browser } from '$app/environment';
  import { SvelteSet } from 'svelte/reactivity';
  import Papa from 'papaparse';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { Progress } from '@cio/ui/base/progress';
  import { Spinner } from '@cio/ui/base/spinner';
  import * as Table from '@cio/ui/base/table';
  import * as Select from '@cio/ui/base/select';
  import * as Pagination from '@cio/ui/base/pagination';
  import { Search } from '@cio/ui/custom/search';
  import { Empty } from '@cio/ui/custom/empty';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
  import FileSpreadsheetIcon from '@lucide/svelte/icons/file-spreadsheet';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
  import FileIcon from '@lucide/svelte/icons/file';
  import { caseloadApi, type ProgressionRow, type ActivityStatus } from '$features/caseload/api/caseload.svelte';
  import { snackbar } from '$features/ui/snackbar/store';

  // Tutor Learner-Progression (PearlLMS Phase 9) — a filterable progress table with expandable per-course
  // detail. The Course filter re-fetches from the server (its metrics are course-scoped); Activity /
  // Progression band / Search / pagination are all client-side over the fetched rows. Allocation-scoped
  // server-side (Tutor = own roster, Admin = org).

  type ActivityFilter = 'all' | ActivityStatus;
  type BandFilter = 'all' | '0-25' | '26-50' | '51-75' | '76-100';

  let searchValue = $state('');
  let activityFilter = $state<ActivityFilter>('all');
  let bandFilter = $state<BandFilter>('all');
  let courseFilter = $state<string>('all');
  let pageSize = $state(10);
  let currentPage = $state(1);
  const expanded = new SvelteSet<string>();

  // Course change re-fetches server-side (also the initial load). The band/activity/search filters stay
  // client-side. A single tracked dep (courseFilter) keeps this to one fetch per course change.
  $effect(() => {
    const cf = courseFilter;
    currentPage = 1;
    caseloadApi.loadProgression(cf === 'all' ? undefined : cf);
  });

  const data = $derived(caseloadApi.progression);
  const courses = $derived(data?.courses ?? []);
  const rows = $derived(data?.rows ?? []);

  function inBand(p: number): boolean {
    switch (bandFilter) {
      case '0-25':
        return p >= 0 && p <= 25;
      case '26-50':
        return p >= 26 && p <= 50;
      case '51-75':
        return p >= 51 && p <= 75;
      case '76-100':
        return p >= 76 && p <= 100;
      default:
        return true;
    }
  }

  const filteredRows = $derived.by(() => {
    const q = searchValue.trim().toLowerCase();
    return rows.filter((r) => {
      if (activityFilter !== 'all' && r.activity !== activityFilter) return false;
      if (!inBand(r.currentPercent)) return false;
      if (q && !(r.name ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  });

  const totalPages = $derived(Math.max(1, Math.ceil(filteredRows.length / pageSize)));
  // Keep the current page in range as filters/size change.
  $effect(() => {
    if (currentPage > totalPages) currentPage = totalPages;
  });
  const pagedRows = $derived(filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize));

  const ACTIVITY_LABELS: Record<ActivityFilter, string> = {
    all: 'All',
    active: 'Active',
    inactive: 'Inactive',
    created: 'Created'
  };
  const BAND_LABELS: Record<BandFilter, string> = {
    all: 'All',
    '0-25': '0 – 25%',
    '26-50': '26 – 50%',
    '51-75': '51 – 75%',
    '76-100': '76 – 100%'
  };
  const PAGE_SIZES = [10, 25, 50, 100];

  function resetFilters() {
    searchValue = '';
    activityFilter = 'all';
    bandFilter = 'all';
    courseFilter = 'all';
    currentPage = 1;
  }

  function activityVariant(a: ActivityStatus): 'success' | 'secondary' | 'warning' {
    if (a === 'active') return 'success';
    if (a === 'created') return 'warning';
    return 'secondary';
  }
  function activityLabel(a: ActivityStatus): string {
    return a === 'active' ? 'Active' : a === 'inactive' ? 'Inactive' : 'Created';
  }
  function statusVariant(status: string): 'success' | 'destructive' | 'secondary' | 'outline' {
    if (status === 'Pass') return 'success';
    if (status === 'Refer') return 'destructive';
    if (status === 'Draft feedback') return 'secondary';
    return 'outline';
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
  }
  function formatSeconds(s: number): string {
    if (!s || s < 1) return '—';
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return '<1m';
  }

  async function toggleRow(learnerId: string) {
    if (expanded.has(learnerId)) {
      expanded.delete(learnerId);
      return;
    }
    expanded.add(learnerId);
    if (!caseloadApi.progressionDetail[learnerId]) {
      await caseloadApi.loadProgressionDetail(learnerId);
    }
  }

  function openDoc(courseId: string, lessonId: string, key: string | null) {
    if (!key) return;
    caseloadApi.openFile(courseId, lessonId, key);
  }

  // ── Export (client-only, lazy-loaded). Reflects the CURRENT filtered+searched rows (all pages). ──
  function exportName(r: ProgressionRow) {
    return {
      Learner: r.name ?? '',
      'Start Date': formatDate(r.startDate),
      Activity: activityLabel(r.activity),
      'Current %': `${r.currentPercent}%`,
      Workbooks: `${r.workbooks.passed} / ${r.workbooks.total} Passed`,
      'Case Studies': `${r.caseStudies.passed} / ${r.caseStudies.total} Passed`
    };
  }

  function exportExcel() {
    if (!browser || filteredRows.length === 0) return;
    const csv = Papa.unparse(filteredRows.map(exportName));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'learner-progression.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function exportPDF() {
    if (!browser || filteredRows.length === 0) return;
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable')
      ]);
      const doc = new jsPDF({ orientation: 'landscape' });
      const head = [['Learner', 'Start Date', 'Activity', 'Current %', 'Workbooks', 'Case Studies']];
      const body = filteredRows.map((r) => [
        r.name ?? '',
        formatDate(r.startDate),
        activityLabel(r.activity),
        `${r.currentPercent}%`,
        `${r.workbooks.passed} / ${r.workbooks.total} Passed`,
        `${r.caseStudies.passed} / ${r.caseStudies.total} Passed`
      ]);
      autoTable(doc, {
        head,
        body,
        startY: 20,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [22, 160, 133] },
        didDrawPage: (d) => {
          doc.setFontSize(14);
          doc.setTextColor(40);
          doc.text('Learner Progression', d.settings.margin.left, 10);
        }
      });
      doc.save('learner-progression.pdf');
    } catch (error) {
      console.error('Error generating PDF:', error);
      snackbar.error('Could not generate the PDF export.');
    }
  }
</script>

<svelte:head>
  <title>Learner Progression — Pearl LMS</title>
</svelte:head>

<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
  <h1 class="text-2xl font-semibold tracking-tight">Learner Progression</h1>
</div>

<!-- Filter bar -->
<div class="mb-4 flex flex-wrap items-end gap-3">
  <div class="flex flex-col gap-1">
    <span class="text-muted-foreground text-xs">Activity Status</span>
    <Select.Root type="single" bind:value={activityFilter}>
      <Select.Trigger class="min-w-[130px]">
        <p>{ACTIVITY_LABELS[activityFilter]}</p>
      </Select.Trigger>
      <Select.Content>
        {#each Object.keys(ACTIVITY_LABELS) as key (key)}
          <Select.Item value={key}>{ACTIVITY_LABELS[key as ActivityFilter]}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <div class="flex flex-col gap-1">
    <span class="text-muted-foreground text-xs">Progression</span>
    <Select.Root type="single" bind:value={bandFilter}>
      <Select.Trigger class="min-w-[130px]">
        <p>{BAND_LABELS[bandFilter]}</p>
      </Select.Trigger>
      <Select.Content>
        {#each Object.keys(BAND_LABELS) as key (key)}
          <Select.Item value={key}>{BAND_LABELS[key as BandFilter]}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <div class="flex flex-col gap-1">
    <span class="text-muted-foreground text-xs">Course</span>
    <Select.Root type="single" bind:value={courseFilter}>
      <Select.Trigger class="min-w-[180px]">
        <p class="truncate">{courseFilter === 'all' ? 'All Courses' : (courses.find((c) => c.courseId === courseFilter)?.title ?? 'Course')}</p>
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="all">All Courses</Select.Item>
        {#each courses as c (c.courseId)}
          <Select.Item value={c.courseId}>{c.title}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <Button variant="outline" onclick={resetFilters}>
    <RotateCcwIcon size={16} class="mr-1" />
    Reset Filters
  </Button>
</div>

<!-- Toolbar: exports + show-N + search -->
<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
  <div class="flex items-center gap-2">
    <Button variant="outline" onclick={exportExcel} disabled={filteredRows.length === 0}>
      <FileSpreadsheetIcon size={16} class="mr-1" />
      Excel
    </Button>
    <Button variant="outline" onclick={exportPDF} disabled={filteredRows.length === 0}>
      <FileTextIcon size={16} class="mr-1" />
      PDF
    </Button>
  </div>
  <div class="flex items-center gap-3">
    <div class="flex items-center gap-2">
      <span class="text-muted-foreground text-sm">Show</span>
      <Select.Root type="single" value={String(pageSize)} onValueChange={(v) => { pageSize = Number(v); currentPage = 1; }}>
        <Select.Trigger class="w-[80px]">
          <p>{pageSize}</p>
        </Select.Trigger>
        <Select.Content>
          {#each PAGE_SIZES as n (n)}
            <Select.Item value={String(n)}>{n}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
      <span class="text-muted-foreground text-sm">entries</span>
    </div>
    <Search placeholder="Search learners" bind:value={searchValue} />
  </div>
</div>

{#if !data}
  <div class="flex justify-center py-16"><Spinner /></div>
{:else if filteredRows.length === 0}
  <Empty
    title="No learners to show"
    description={rows.length === 0
      ? 'Learners appear here once they are allocated to you.'
      : 'No learners match the current filters.'}
    icon={TrendingUpIcon}
    variant="page"
  />
{:else}
  <div class="overflow-x-auto rounded-md border">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head class="w-10"></Table.Head>
          <Table.Head>Learner Name</Table.Head>
          <Table.Head>Start Date</Table.Head>
          <Table.Head>Activity</Table.Head>
          <Table.Head class="w-48">Current %</Table.Head>
          <Table.Head>Workbooks</Table.Head>
          <Table.Head>Case Studies</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each pagedRows as row (row.learnerId)}
          {@const isOpen = expanded.has(row.learnerId)}
          <Table.Row>
            <Table.Cell>
              <button
                type="button"
                class="hover:bg-muted flex size-6 items-center justify-center rounded"
                aria-label={isOpen ? 'Collapse' : 'Expand'}
                onclick={() => toggleRow(row.learnerId)}
              >
                {#if isOpen}
                  <ChevronDownIcon size={16} />
                {:else}
                  <ChevronRightIcon size={16} />
                {/if}
              </button>
            </Table.Cell>
            <Table.Cell class="font-medium">
              <div class="flex items-center gap-2">
                <span>{row.name ?? 'Learner'}</span>
                {#if row.currentUnitIndex != null}
                  <Badge variant="outline">Unit {row.currentUnitIndex}</Badge>
                {/if}
              </div>
            </Table.Cell>
            <Table.Cell>{formatDate(row.startDate)}</Table.Cell>
            <Table.Cell>
              <Badge variant={activityVariant(row.activity)}>{activityLabel(row.activity)}</Badge>
            </Table.Cell>
            <Table.Cell>
              <div class="flex items-center gap-2">
                <Progress value={row.currentPercent} class="w-28" />
                <span class="text-sm tabular-nums">{row.currentPercent}%</span>
              </div>
            </Table.Cell>
            <Table.Cell>{row.workbooks.passed} / {row.workbooks.total} Passed</Table.Cell>
            <Table.Cell>{row.caseStudies.passed} / {row.caseStudies.total} Passed</Table.Cell>
          </Table.Row>

          {#if isOpen}
            <Table.Row>
              <Table.Cell colspan={7} class="bg-muted/30 p-4">
                {#if caseloadApi.progressionDetailLoading[row.learnerId] && !caseloadApi.progressionDetail[row.learnerId]}
                  <div class="flex justify-center py-6"><Spinner /></div>
                {:else if caseloadApi.progressionDetail[row.learnerId]}
                  {@const detail = caseloadApi.progressionDetail[row.learnerId]}
                  {#if detail.courses.length === 0}
                    <p class="text-muted-foreground py-4 text-center text-sm">
                      This learner is not enrolled in any courses yet.
                    </p>
                  {:else}
                    <div class="flex flex-col gap-6">
                      {#each detail.courses as course (course.courseId)}
                        <div class="bg-background rounded-md border">
                          <!-- Course header band -->
                          <div class="flex flex-wrap items-center justify-between gap-3 border-b p-3">
                            <div class="font-medium">{course.title}</div>
                            <div class="flex flex-wrap items-center gap-4 text-sm">
                              <span class="text-muted-foreground">WB: {course.workbooks.passed}/{course.workbooks.total} Passed</span>
                              <span class="text-muted-foreground">CS: {course.caseStudies.passed}/{course.caseStudies.total} Passed</span>
                              <span class="text-muted-foreground">Time: {formatSeconds(course.totalTimeSeconds)}</span>
                              <span class="flex items-center gap-2">
                                <Progress value={course.percent} class="w-24" />
                                <span class="tabular-nums">{course.percent}%</span>
                              </span>
                            </div>
                          </div>

                          <!-- Unit table -->
                          <Table.Root>
                            <Table.Header>
                              <Table.Row>
                                <Table.Head>Assignment / Unit</Table.Head>
                                <Table.Head>Document</Table.Head>
                                <Table.Head>Submitted</Table.Head>
                                <Table.Head>Marked</Table.Head>
                                <Table.Head>Status</Table.Head>
                                <Table.Head class="text-right">Time Spent</Table.Head>
                              </Table.Row>
                            </Table.Header>
                            <Table.Body>
                              {#each course.units as unit (unit.lessonId)}
                                <Table.Row class="bg-muted/40">
                                  <Table.Cell colspan={5} class="font-medium">{unit.unitTitle}</Table.Cell>
                                  <Table.Cell class="text-right text-sm">{formatSeconds(unit.timeSeconds)}</Table.Cell>
                                </Table.Row>
                                {#if unit.submissions.length === 0}
                                  <Table.Row>
                                    <Table.Cell class="text-muted-foreground pl-6 text-sm">—</Table.Cell>
                                    <Table.Cell class="text-muted-foreground text-sm">—</Table.Cell>
                                    <Table.Cell class="text-muted-foreground text-sm">—</Table.Cell>
                                    <Table.Cell class="text-muted-foreground text-sm">—</Table.Cell>
                                    <Table.Cell class="text-muted-foreground text-sm">—</Table.Cell>
                                    <Table.Cell></Table.Cell>
                                  </Table.Row>
                                {:else}
                                  {#each unit.submissions as sub, i (sub.assessmentName + i)}
                                    <Table.Row>
                                      <Table.Cell class="pl-6">
                                        <div class="flex items-center gap-2">
                                          <span>{sub.assessmentName}</span>
                                          <Badge variant="outline" class="capitalize">{sub.kind}</Badge>
                                        </div>
                                      </Table.Cell>
                                      <Table.Cell>
                                        {#if sub.documentKey}
                                          <button
                                            type="button"
                                            class="ui:text-primary inline-flex items-center gap-1 text-sm hover:underline"
                                            onclick={() => openDoc(course.courseId, unit.lessonId, sub.documentKey)}
                                          >
                                            <FileIcon size={14} />
                                            {sub.documentName}
                                          </button>
                                        {:else}
                                          <span class="text-muted-foreground text-sm">{sub.documentName}</span>
                                        {/if}
                                      </Table.Cell>
                                      <Table.Cell class="text-sm">{formatDate(sub.submittedAt)}</Table.Cell>
                                      <Table.Cell class="text-sm">{formatDate(sub.markedAt)}</Table.Cell>
                                      <Table.Cell>
                                        <Badge variant={statusVariant(sub.status)}>{sub.status}</Badge>
                                      </Table.Cell>
                                      <Table.Cell></Table.Cell>
                                    </Table.Row>
                                  {/each}
                                {/if}
                              {/each}
                            </Table.Body>
                          </Table.Root>
                        </div>
                      {/each}
                    </div>
                  {/if}
                {:else}
                  <p class="text-muted-foreground py-4 text-center text-sm">Could not load detail.</p>
                {/if}
              </Table.Cell>
            </Table.Row>
          {/if}
        {/each}
      </Table.Body>
    </Table.Root>
  </div>

  <!-- Pagination + count -->
  <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
    <span class="text-muted-foreground text-sm">
      Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredRows.length)} of {filteredRows.length}
    </span>
    {#if totalPages > 1}
      <Pagination.Root count={filteredRows.length} perPage={pageSize} page={currentPage} onPageChange={(p) => (currentPage = p)}>
        {#snippet children({ pages, currentPage: activePage })}
          <Pagination.Content>
            <Pagination.Item>
              <Pagination.PrevButton />
            </Pagination.Item>
            {#each pages as pageItem (pageItem.key)}
              {#if pageItem.type === 'ellipsis'}
                <Pagination.Item>
                  <Pagination.Ellipsis />
                </Pagination.Item>
              {:else}
                <Pagination.Item>
                  <Pagination.Link page={pageItem} isActive={activePage === pageItem.value}>
                    {pageItem.value}
                  </Pagination.Link>
                </Pagination.Item>
              {/if}
            {/each}
            <Pagination.Item>
              <Pagination.NextButton />
            </Pagination.Item>
          </Pagination.Content>
        {/snippet}
      </Pagination.Root>
    {/if}
  </div>
{/if}
