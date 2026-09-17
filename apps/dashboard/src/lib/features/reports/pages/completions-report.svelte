<script lang="ts">
  import { onMount } from 'svelte';
  import * as Page from '@cio/ui/base/page';
  import * as Table from '@cio/ui/base/table';
  import { Button } from '@cio/ui/base/button';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import { reportsApi } from '$features/reports/api/reports.svelte';
  import { downloadCsv } from '$features/admin-dashboard/utils/export-csv';
  import ReportKpi from '$features/reports/components/report-kpi.svelte';
  import BarList from '$features/reports/components/bar-list.svelte';

  // Completions & certificates — totals, monthly trend, per-course completion rate + time-to-complete.

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  onMount(() => {
    reportsApi.loadCompletions();
  });

  const r = $derived(reportsApi.completions);

  function exportCourses() {
    if (!r) return;
    downloadCsv(
      `completions-by-course-${new Date().toISOString().slice(0, 10)}`,
      ['Course', 'Enrolled', 'Completed', 'Completion %', 'Avg days to complete'],
      r.byCourse.map((c) => [c.title, c.enrolled, c.completed, c.rate, c.avgDays ?? ''])
    );
  }
</script>

<svelte:head><title>Completions Report</title></svelte:head>

<Page.Root class="w-full">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>Completions & Certificates</Page.Title>
      <Page.Subtitle>Course completions, certificates and time-to-complete</Page.Subtitle>
    </Page.HeaderContent>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      {#if !r}
        <p class="ui:text-muted-foreground text-sm">Loading…</p>
      {:else}
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <ReportKpi label="Total completions" value={r.totalCompletions} />
          <ReportKpi label="Completed this month" value={r.completionsThisMonth} />
          <ReportKpi
            label="Certificates earned"
            value={r.certificates.total}
            sub={`${r.certificates.thisMonth} this month`}
          />
          <ReportKpi
            label="Avg time to complete"
            value={r.avgTimeToCompleteDays != null ? `${r.avgTimeToCompleteDays} days` : '—'}
          />
        </div>

        <div class="bg-card mt-5 rounded-xl border p-4">
          <h3 class="mb-3 text-sm font-semibold">Completions this year</h3>
          <BarList
            items={r.completionsTrend.map((t) => ({ label: MONTHS[t.month - 1] ?? String(t.month), value: t.count }))}
            labelWidth="w-10"
          />
        </div>

        <div class="bg-card mt-5 rounded-xl border p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold">By course</h3>
            <Button variant="outline" size="sm" onclick={exportCourses} disabled={r.byCourse.length === 0}>
              <DownloadIcon class="size-4" /> Export CSV
            </Button>
          </div>
          <div class="overflow-x-auto rounded-md border">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Course</Table.Head>
                  <Table.Head class="text-right">Enrolled</Table.Head>
                  <Table.Head class="text-right">Completed</Table.Head>
                  <Table.Head class="text-right">Completion</Table.Head>
                  <Table.Head class="text-right">Avg days</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#if r.byCourse.length === 0}
                  <Table.Row>
                    <Table.Cell colspan={5} class="ui:text-muted-foreground py-8 text-center text-sm"
                      >No courses yet.</Table.Cell
                    >
                  </Table.Row>
                {:else}
                  {#each r.byCourse as c (c.courseId)}
                    <Table.Row>
                      <Table.Cell class="font-medium">{c.title}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{c.enrolled}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{c.completed}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{c.rate}%</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{c.avgDays != null ? c.avgDays : '—'}</Table.Cell>
                    </Table.Row>
                  {/each}
                {/if}
              </Table.Body>
            </Table.Root>
          </div>
        </div>
      {/if}
    {/snippet}
  </Page.Body>
</Page.Root>
