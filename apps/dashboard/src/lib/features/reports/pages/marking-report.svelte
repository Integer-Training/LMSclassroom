<script lang="ts">
  import * as Page from '@cio/ui/base/page';
  import * as Table from '@cio/ui/base/table';
  import { Button } from '@cio/ui/base/button';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import { currentOrg } from '$lib/utils/store/org';
  import { adminDashboardApi } from '$features/admin-dashboard/api/admin-dashboard.svelte';
  import { downloadCsv } from '$features/admin-dashboard/utils/export-csv';
  import ReportKpi from '$features/reports/components/report-kpi.svelte';
  import BarList from '$features/reports/components/bar-list.svelte';

  // Marking report — coursework throughput, backlog, SLA, turnaround, outcomes, per-tutor performance.
  // Renders off the shared admin-overview bundle.

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let loadedForOrg: string | null = null;
  $effect(() => {
    const orgId = $currentOrg.id;
    if (!orgId || loadedForOrg === orgId) return;
    loadedForOrg = orgId;
    adminDashboardApi.loadOverview(orgId).then((res) => {
      if (!res) loadedForOrg = null;
    });
  });

  const o = $derived(adminDashboardApi.overview);
  const h = $derived(o?.headline);
  const slaBreach = $derived(h && h.awaitingMarking > 0 ? Math.round((h.overdue / h.awaitingMarking) * 100) : 0);

  function exportTutors() {
    if (!o) return;
    downloadCsv(
      `tutor-performance-${new Date().toISOString().slice(0, 10)}`,
      ['Tutor', 'Email', 'Learners', 'Awaiting marking', 'Inactive learners', 'Avg turnaround (days)', 'Pass rate %'],
      o.tutors.map((t) => [
        t.name ?? '',
        t.email ?? '',
        t.learners,
        t.awaitingMarking,
        t.inactiveLearners,
        t.avgTurnaroundDays ?? '',
        t.passRate ?? ''
      ])
    );
  }
</script>

<svelte:head><title>Marking Report</title></svelte:head>

<Page.Root class="w-full">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>Marking</Page.Title>
      <Page.Subtitle>Coursework throughput, backlog, turnaround and outcomes</Page.Subtitle>
    </Page.HeaderContent>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      {#if !o || !h}
        <p class="ui:text-muted-foreground text-sm">Loading…</p>
      {:else}
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <ReportKpi label="Awaiting marking" value={h.awaitingMarking} sub={`${h.dueSoon} due soon`} />
          <ReportKpi label="Overdue" value={h.overdue} sub={`${slaBreach}% SLA breach`} />
          <ReportKpi label="Draft feedback" value={h.awaitingDraftFeedback} />
          <ReportKpi label="Avg turnaround" value={h.avgTurnaroundDays != null ? `${h.avgTurnaroundDays} d` : '—'} />
          <ReportKpi
            label="Pass rate"
            value={h.passRate != null ? `${h.passRate}%` : '—'}
            sub={`${h.totalGraded} graded`}
          />
          <ReportKpi label="Resubmissions" value={h.resubmissions} />
        </div>

        <div class="mt-5 grid gap-4 lg:grid-cols-2">
          <div class="bg-card rounded-xl border p-4">
            <h3 class="mb-3 text-sm font-semibold">Outcomes</h3>
            <BarList
              items={[
                { label: 'Pass', value: h.passCount },
                { label: 'Refer', value: h.referCount }
              ]}
            />
          </div>
          <div class="bg-card rounded-xl border p-4">
            <h3 class="mb-3 text-sm font-semibold">Submissions this year</h3>
            <BarList
              items={o.charts.submissionsTrend.map((t) => ({
                label: MONTHS[t.month - 1] ?? String(t.month),
                value: t.count
              }))}
              labelWidth="w-10"
            />
          </div>
        </div>

        <div class="bg-card mt-5 rounded-xl border p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold">Tutor performance</h3>
            <Button variant="outline" size="sm" onclick={exportTutors} disabled={o.tutors.length === 0}>
              <DownloadIcon class="size-4" /> Export CSV
            </Button>
          </div>
          <div class="overflow-x-auto rounded-md border">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Tutor</Table.Head>
                  <Table.Head class="text-right">Learners</Table.Head>
                  <Table.Head class="text-right">Awaiting</Table.Head>
                  <Table.Head class="text-right">Inactive</Table.Head>
                  <Table.Head class="text-right">Turnaround</Table.Head>
                  <Table.Head class="text-right">Pass rate</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#if o.tutors.length === 0}
                  <Table.Row>
                    <Table.Cell colspan={6} class="ui:text-muted-foreground py-8 text-center text-sm"
                      >No tutors yet.</Table.Cell
                    >
                  </Table.Row>
                {:else}
                  {#each o.tutors as t (t.tutorId)}
                    <Table.Row>
                      <Table.Cell class="font-medium">{t.name ?? 'Tutor'}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{t.learners}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{t.awaitingMarking}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{t.inactiveLearners}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums"
                        >{t.avgTurnaroundDays != null ? `${t.avgTurnaroundDays} d` : '—'}</Table.Cell
                      >
                      <Table.Cell class="text-right tabular-nums"
                        >{t.passRate != null ? `${t.passRate}%` : '—'}</Table.Cell
                      >
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
