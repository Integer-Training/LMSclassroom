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

  // Tutor feedback — ADMIN ONLY. The learner→tutor feedback collected by the every-N-units popup: per-tutor
  // average ratings (the headline) + the individual entries with comments. Gated three ways: nav
  // (requiresAdmin), API (requireAdmin), and this page body ({#if $isOrgAdmin}).

  onMount(() => {
    if ($isOrgAdmin) reportsApi.loadTutorFeedback();
  });

  $effect(() => {
    if ($isOrgAdmin && !reportsApi.tutorFeedback) reportsApi.loadTutorFeedback();
  });

  const r = $derived(reportsApi.tutorFeedback);

  function fmtDate(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
  }

  /** A nullable average → "4.2" or "—". */
  function num(n: number | null): string {
    return n == null ? '—' : String(n);
  }

  function exportTutors() {
    if (!r) return;
    downloadCsv(
      `tutor-feedback-by-tutor-${new Date().toISOString().slice(0, 10)}`,
      ['Tutor', 'Responses', 'Avg overall', 'Avg communication', 'Avg helpfulness', 'Avg knowledge'],
      r.perTutor.map((t) => [
        t.name,
        t.count,
        t.avgOverall,
        num(t.avgCommunication),
        num(t.avgHelpfulness),
        num(t.avgKnowledge)
      ])
    );
  }

  function exportEntries() {
    if (!r) return;
    downloadCsv(
      `tutor-feedback-entries-${new Date().toISOString().slice(0, 10)}`,
      ['Date', 'Learner', 'Tutor', 'Unit milestone', 'Overall', 'Communication', 'Helpfulness', 'Knowledge', 'Comment'],
      r.entries.map((e) => [
        fmtDate(e.createdAt),
        e.learnerName,
        e.tutorName,
        e.milestone,
        e.overallRating,
        num(e.communicationRating),
        num(e.helpfulnessRating),
        num(e.knowledgeRating),
        e.comment ?? ''
      ])
    );
  }
</script>

<svelte:head><title>Tutor Feedback Report</title></svelte:head>

<Page.Root class="w-full">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>Tutor feedback</Page.Title>
      <Page.Subtitle>Learner feedback about tutors, collected every few units</Page.Subtitle>
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
          <ReportKpi label="Feedback received" value={r.totals.totalFeedback} sub="all-time" />
          <ReportKpi label="Average overall" value={`${r.totals.avgOverall} / 5`} />
          <ReportKpi label="Tutors rated" value={r.totals.tutorsRated} />
          <ReportKpi label="Learners responded" value={r.totals.learnersResponded} />
        </div>

        <div class="bg-card mt-5 rounded-xl border p-4">
          <h3 class="mb-3 text-sm font-semibold">Average overall rating by tutor</h3>
          {#if r.perTutor.length === 0}
            <p class="ui:text-muted-foreground text-sm">No feedback submitted yet.</p>
          {:else}
            <BarList items={r.perTutor.map((t) => ({ label: t.name, value: t.avgOverall }))} labelWidth="w-40" />
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
            Averages are over all feedback for each tutor (1–5). A dash means that dimension was left blank.
          </p>
          <div class="overflow-x-auto rounded-md border">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Tutor</Table.Head>
                  <Table.Head class="text-right">Responses</Table.Head>
                  <Table.Head class="text-right">Overall</Table.Head>
                  <Table.Head class="text-right">Communication</Table.Head>
                  <Table.Head class="text-right">Helpfulness</Table.Head>
                  <Table.Head class="text-right">Knowledge</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#if r.perTutor.length === 0}
                  <Table.Row>
                    <Table.Cell colspan={6} class="ui:text-muted-foreground py-8 text-center text-sm"
                      >No feedback submitted yet.</Table.Cell
                    >
                  </Table.Row>
                {:else}
                  {#each r.perTutor as t (t.tutorId ?? t.name)}
                    <Table.Row>
                      <Table.Cell class="font-medium">{t.name}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{t.count}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{t.avgOverall}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{num(t.avgCommunication)}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{num(t.avgHelpfulness)}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{num(t.avgKnowledge)}</Table.Cell>
                    </Table.Row>
                  {/each}
                {/if}
              </Table.Body>
            </Table.Root>
          </div>
        </div>

        <div class="bg-card mt-5 rounded-xl border p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold">All responses</h3>
            <Button variant="outline" size="sm" onclick={exportEntries} disabled={r.entries.length === 0}>
              <DownloadIcon class="size-4" /> Export CSV
            </Button>
          </div>
          <div class="overflow-x-auto rounded-md border">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head class="text-right">Date</Table.Head>
                  <Table.Head>Learner</Table.Head>
                  <Table.Head>Tutor</Table.Head>
                  <Table.Head class="text-right">Unit</Table.Head>
                  <Table.Head class="text-right">Overall</Table.Head>
                  <Table.Head class="text-right">Comm.</Table.Head>
                  <Table.Head class="text-right">Help.</Table.Head>
                  <Table.Head class="text-right">Know.</Table.Head>
                  <Table.Head>Comment</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#if r.entries.length === 0}
                  <Table.Row>
                    <Table.Cell colspan={9} class="ui:text-muted-foreground py-8 text-center text-sm"
                      >No feedback submitted yet.</Table.Cell
                    >
                  </Table.Row>
                {:else}
                  {#each r.entries as e (e.id)}
                    <Table.Row>
                      <Table.Cell class="text-right whitespace-nowrap tabular-nums">{fmtDate(e.createdAt)}</Table.Cell>
                      <Table.Cell class="font-medium">{e.learnerName}</Table.Cell>
                      <Table.Cell>{e.tutorName}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{e.milestone}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{e.overallRating}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{num(e.communicationRating)}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{num(e.helpfulnessRating)}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{num(e.knowledgeRating)}</Table.Cell>
                      <Table.Cell class="max-w-xs break-words whitespace-pre-wrap">{e.comment ?? '—'}</Table.Cell>
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
