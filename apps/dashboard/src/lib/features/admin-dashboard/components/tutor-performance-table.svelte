<script lang="ts">
  import * as Table from '@cio/ui/base/table';
  import { Input } from '@cio/ui/base/input';
  import { Button } from '@cio/ui/base/button';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import { downloadCsv } from '$features/admin-dashboard/utils/export-csv';
  import type { AdminTutorRow } from '$features/admin-dashboard/api/admin-dashboard.svelte';

  interface Props {
    tutors: AdminTutorRow[];
  }

  let { tutors }: Props = $props();

  let search = $state('');

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tutors;
    return tutors.filter((t) => (t.name ?? '').toLowerCase().includes(q) || (t.email ?? '').toLowerCase().includes(q));
  });

  const na = (v: number | null) => (v === null ? 'N/A' : v);

  function exportCsv() {
    downloadCsv(
      'tutor-performance',
      ['Name', 'Email', 'Learners', 'Awaiting Marking', 'Inactive', 'Avg Turnaround (days)', 'Pass Rate %'],
      filtered.map((t) => [
        t.name ?? '',
        t.email ?? '',
        t.learners,
        t.awaitingMarking,
        t.inactiveLearners,
        t.avgTurnaroundDays ?? 'N/A',
        t.passRate ?? 'N/A'
      ])
    );
  }
</script>

<div>
  <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
    <h2 class="text-lg font-semibold tracking-tight">Tutor Performance</h2>
    <div class="flex items-center gap-2">
      <Input placeholder="Search tutors…" bind:value={search} class="h-9 w-48" />
      <Button variant="outline" size="sm" onclick={exportCsv} disabled={filtered.length === 0}>
        <DownloadIcon class="mr-1 size-4" /> Export CSV
      </Button>
    </div>
  </div>

  <div class="overflow-x-auto rounded-md border">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>Name</Table.Head>
          <Table.Head>Email</Table.Head>
          <Table.Head class="text-right">Learners</Table.Head>
          <Table.Head class="text-right">Awaiting Marking</Table.Head>
          <Table.Head class="text-right">Inactive</Table.Head>
          <Table.Head class="text-right">Avg Turn. (days)</Table.Head>
          <Table.Head class="text-right">Pass Rate %</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#if filtered.length === 0}
          <Table.Row>
            <Table.Cell colspan={7} class="text-muted-foreground text-center text-sm">
              {tutors.length === 0 ? 'No tutors yet.' : 'No tutors match your search.'}
            </Table.Cell>
          </Table.Row>
        {:else}
          {#each filtered as tutor (tutor.tutorId)}
            <Table.Row>
              <Table.Cell class="font-medium">{tutor.name || 'Tutor'}</Table.Cell>
              <Table.Cell class="text-muted-foreground">{tutor.email ?? ''}</Table.Cell>
              <Table.Cell class="text-right tabular-nums">{tutor.learners}</Table.Cell>
              <Table.Cell class="text-right tabular-nums">{tutor.awaitingMarking}</Table.Cell>
              <Table.Cell class="text-right tabular-nums">{tutor.inactiveLearners}</Table.Cell>
              <Table.Cell class="text-right tabular-nums">{na(tutor.avgTurnaroundDays)}</Table.Cell>
              <Table.Cell class="text-right tabular-nums">{na(tutor.passRate)}</Table.Cell>
            </Table.Row>
          {/each}
        {/if}
      </Table.Body>
    </Table.Root>
  </div>
</div>
