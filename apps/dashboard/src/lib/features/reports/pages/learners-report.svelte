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

  // Learner progression report — activity mix, progress distribution, assessment throughput, at-risk list.

  onMount(() => {
    reportsApi.loadLearners();
  });

  const r = $derived(reportsApi.learners);

  function fmtDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? '—'
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function exportAtRisk() {
    if (!r) return;
    downloadCsv(
      `at-risk-learners-${new Date().toISOString().slice(0, 10)}`,
      ['Name', 'Progress %', 'Started'],
      r.atRisk.map((a) => [
        a.name ?? '',
        a.percent,
        a.startDate ? new Date(a.startDate).toISOString().slice(0, 10) : ''
      ])
    );
  }
</script>

<svelte:head><title>Learners Report</title></svelte:head>

<Page.Root class="w-full">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>Learners</Page.Title>
      <Page.Subtitle>Progression, activity and at-risk learners</Page.Subtitle>
    </Page.HeaderContent>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      {#if !r}
        <p class="ui:text-muted-foreground text-sm">Loading…</p>
      {:else}
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <ReportKpi label="Total learners" value={r.total} />
          <ReportKpi label="Active" value={r.activity.active} sub="logged in ≤30 days" />
          <ReportKpi label="Inactive" value={r.activity.inactive} sub="30+ days idle" />
          <ReportKpi label="New this month" value={r.newThisMonth} />
          <ReportKpi label="Avg progress" value={`${r.avgProgress}%`} />
        </div>

        <div class="mt-5 grid gap-4 lg:grid-cols-2">
          <div class="bg-card rounded-xl border p-4">
            <h3 class="mb-3 text-sm font-semibold">Progress distribution</h3>
            <BarList items={r.distribution.map((d) => ({ label: d.bucket, value: d.count }))} />
          </div>
          <div class="bg-card rounded-xl border p-4">
            <h3 class="mb-3 text-sm font-semibold">Assessment throughput</h3>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <p class="ui:text-muted-foreground text-xs">Workbooks passed</p>
                <p class="text-xl font-semibold tabular-nums">
                  {r.workbooks.passed}<span class="ui:text-muted-foreground text-sm"> / {r.workbooks.total}</span>
                </p>
              </div>
              <div>
                <p class="ui:text-muted-foreground text-xs">Case studies passed</p>
                <p class="text-xl font-semibold tabular-nums">
                  {r.caseStudies.passed}<span class="ui:text-muted-foreground text-sm"> / {r.caseStudies.total}</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        <div class="bg-card mt-5 rounded-xl border p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold">
              At-risk learners <span class="ui:text-muted-foreground font-normal">({r.atRisk.length})</span>
            </h3>
            <Button variant="outline" size="sm" onclick={exportAtRisk} disabled={r.atRisk.length === 0}>
              <DownloadIcon class="size-4" /> Export CSV
            </Button>
          </div>
          <p class="ui:text-muted-foreground mb-3 text-xs">
            Inactive for 30+ days and not yet finished — worth a nudge.
          </p>
          <div class="overflow-x-auto rounded-md border">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Name</Table.Head>
                  <Table.Head class="text-right">Progress</Table.Head>
                  <Table.Head>Started</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#if r.atRisk.length === 0}
                  <Table.Row>
                    <Table.Cell colspan={3} class="ui:text-muted-foreground py-8 text-center text-sm"
                      >No at-risk learners 🎉</Table.Cell
                    >
                  </Table.Row>
                {:else}
                  {#each r.atRisk as a (a.learnerId)}
                    <Table.Row>
                      <Table.Cell class="font-medium">{a.name ?? 'Learner'}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{a.percent}%</Table.Cell>
                      <Table.Cell class="ui:text-muted-foreground">{fmtDate(a.startDate)}</Table.Cell>
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
