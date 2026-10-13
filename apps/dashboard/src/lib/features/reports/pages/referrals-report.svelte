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
  import { isOrgAdmin } from '$lib/utils/store/org';

  // Referrals / failing — ADMIN ONLY. Per-tutor strictness (who entered the Refer) + per-learner
  // seriousness. A "refer" is a non-passing coursework verdict; every resubmission's verdict is counted.
  // Gated three ways: nav (requiresAdmin), API (requireAdmin), and this page body ({#if $isOrgAdmin}).

  onMount(() => {
    if ($isOrgAdmin) reportsApi.loadReferrals();
  });

  // Load as soon as the role resolves (store may still be null on first mount).
  $effect(() => {
    if ($isOrgAdmin && !reportsApi.referrals) reportsApi.loadReferrals();
  });

  const r = $derived(reportsApi.referrals);

  function fmtDate(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
  }

  function exportTutors() {
    if (!r) return;
    downloadCsv(
      `referrals-by-tutor-${new Date().toISOString().slice(0, 10)}`,
      ['Tutor', 'Learners referred', 'Total refers', 'Total graded', 'Refer rate %'],
      r.perTutor.map((t) => [t.name, t.learnersReferred, t.totalRefers, t.totalGraded, t.referRate])
    );
  }

  function exportLearners() {
    if (!r) return;
    downloadCsv(
      `referrals-by-learner-${new Date().toISOString().slice(0, 10)}`,
      ['Learner', 'Times referred', 'Units referred', 'Currently open', 'Last referred by', 'Last referred'],
      r.perLearner.map((l) => [
        l.name,
        l.timesReferred,
        l.unitsReferred,
        l.openRefers,
        l.lastReferredBy,
        fmtDate(l.lastReferredAt)
      ])
    );
  }
</script>

<svelte:head><title>Referrals Report</title></svelte:head>

<Page.Root class="w-full">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>Referrals</Page.Title>
      <Page.Subtitle>Failing / resubmit activity — tutor strictness and learner seriousness</Page.Subtitle>
    </Page.HeaderContent>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      {#if $isOrgAdmin === false}
        <p class="ui:text-muted-foreground text-sm">This report is available to admins only.</p>
      {:else if !r}
        <p class="ui:text-muted-foreground text-sm">Loading…</p>
      {:else}
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <ReportKpi label="Total refers" value={r.totals.totalRefers} sub="all-time, all resubmissions" />
          <ReportKpi label="Learners referred" value={r.totals.learnersReferred} />
          <ReportKpi
            label="Currently referred"
            value={r.totals.learnersCurrentlyReferred}
            sub="awaiting a passing resubmit"
          />
          <ReportKpi label="Tutors issuing refers" value={r.totals.tutorsReferring} />
        </div>

        <div class="bg-card mt-5 rounded-xl border p-4">
          <h3 class="mb-3 text-sm font-semibold">Refers by tutor</h3>
          {#if r.perTutor.length === 0}
            <p class="ui:text-muted-foreground text-sm">No refers recorded yet.</p>
          {:else}
            <BarList items={r.perTutor.map((t) => ({ label: t.name, value: t.totalRefers }))} labelWidth="w-40" />
          {/if}
        </div>

        <div class="bg-card mt-5 rounded-xl border p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold">Per tutor</h3>
            <Button variant="outline" size="sm" onclick={exportTutors} disabled={r.perTutor.length === 0}>
              <DownloadIcon class="size-4" /> Export CSV
            </Button>
          </div>
          <p class="ui:text-muted-foreground mb-3 text-xs">
            Attributed to the tutor who entered each Refer. Refer rate = refers ÷ total graded (higher = stricter).
          </p>
          <div class="overflow-x-auto rounded-md border">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Tutor</Table.Head>
                  <Table.Head class="text-right">Learners referred</Table.Head>
                  <Table.Head class="text-right">Total refers</Table.Head>
                  <Table.Head class="text-right">Total graded</Table.Head>
                  <Table.Head class="text-right">Refer rate</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#if r.perTutor.length === 0}
                  <Table.Row>
                    <Table.Cell colspan={5} class="ui:text-muted-foreground py-8 text-center text-sm"
                      >No refers recorded yet.</Table.Cell
                    >
                  </Table.Row>
                {:else}
                  {#each r.perTutor as t (t.tutorId ?? t.name)}
                    <Table.Row>
                      <Table.Cell class="font-medium">{t.name}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{t.learnersReferred}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{t.totalRefers}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{t.totalGraded}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{t.referRate}%</Table.Cell>
                    </Table.Row>
                  {/each}
                {/if}
              </Table.Body>
            </Table.Root>
          </div>
        </div>

        <div class="bg-card mt-5 rounded-xl border p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold">Per learner</h3>
            <Button variant="outline" size="sm" onclick={exportLearners} disabled={r.perLearner.length === 0}>
              <DownloadIcon class="size-4" /> Export CSV
            </Button>
          </div>
          <p class="ui:text-muted-foreground mb-3 text-xs">
            Times referred counts every Refer across resubmissions. "Currently open" = units whose latest verdict is
            still a Refer.
          </p>
          <div class="overflow-x-auto rounded-md border">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Learner</Table.Head>
                  <Table.Head class="text-right">Times referred</Table.Head>
                  <Table.Head class="text-right">Units referred</Table.Head>
                  <Table.Head class="text-right">Currently open</Table.Head>
                  <Table.Head>Last referred by</Table.Head>
                  <Table.Head class="text-right">Last referred</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#if r.perLearner.length === 0}
                  <Table.Row>
                    <Table.Cell colspan={6} class="ui:text-muted-foreground py-8 text-center text-sm"
                      >No refers recorded yet.</Table.Cell
                    >
                  </Table.Row>
                {:else}
                  {#each r.perLearner as l (l.learnerId)}
                    <Table.Row>
                      <Table.Cell class="font-medium">{l.name}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{l.timesReferred}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{l.unitsReferred}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{l.openRefers}</Table.Cell>
                      <Table.Cell>{l.lastReferredBy}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{fmtDate(l.lastReferredAt)}</Table.Cell>
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
