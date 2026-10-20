<script lang="ts">
  import { onMount } from 'svelte';
  import * as Page from '@cio/ui/base/page';
  import * as Table from '@cio/ui/base/table';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import { reportsApi } from '$features/reports/api/reports.svelte';
  import { downloadCsv } from '$features/admin-dashboard/utils/export-csv';
  import ReportKpi from '$features/reports/components/report-kpi.svelte';
  import { isOrgAdmin } from '$lib/utils/store/org';

  // Activity log — ADMIN ONLY. The system_event_log viewer (logins, logouts, API/client errors). Gated three
  // ways: nav (requiresAdmin), API (requireAdmin), and this page body ({#if $isOrgAdmin}). IPs shown are masked.

  const EVENT_TYPES = [
    'auth.login.success',
    'auth.login.failure',
    'auth.logout',
    'auth.session_invalid_bounce',
    'api.error',
    'client.error'
  ];
  const SEVERITIES = ['info', 'warn', 'error'];

  let fromDate = $state('');
  let toDate = $state('');
  let eventType = $state('');
  let severity = $state('');
  let status = $state('');
  let email = $state('');

  function apply() {
    reportsApi.loadActivityLog({
      // Date inputs are YYYY-MM-DD; `to` is inclusive of the whole day.
      from: fromDate ? new Date(`${fromDate}T00:00:00`).toISOString() : undefined,
      to: toDate ? new Date(`${toDate}T23:59:59.999`).toISOString() : undefined,
      eventType: eventType || undefined,
      severity: severity || undefined,
      status: String(status ?? '').trim() || undefined,
      email: email.trim() || undefined
    });
  }

  function reset() {
    fromDate = toDate = eventType = severity = status = email = '';
    apply();
  }

  onMount(() => {
    if ($isOrgAdmin) apply();
  });

  $effect(() => {
    if ($isOrgAdmin && !reportsApi.activityLog) apply();
  });

  const r = $derived(reportsApi.activityLog);

  function fmtTime(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 19).replace('T', ' ');
  }

  function exportRows() {
    if (!r) return;
    downloadCsv(
      `activity-log-${new Date().toISOString().slice(0, 10)}`,
      ['Time (UTC)', 'Event type', 'Severity', 'User email', 'IP (masked)', 'Path', 'Status', 'Message'],
      r.rows.map((e) => [
        fmtTime(e.occurredAt),
        e.eventType,
        e.severity,
        e.userEmail ?? '',
        e.ipMasked ?? '',
        e.path ?? '',
        e.httpStatus ?? '',
        e.message ?? ''
      ])
    );
  }

  const fieldClass = 'bg-background h-9 rounded-md border px-2 text-sm';
</script>

<svelte:head><title>Activity Log</title></svelte:head>

<Page.Root class="w-full">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>Activity log</Page.Title>
      <Page.Subtitle>Logins, logouts and errors across the platform</Page.Subtitle>
    </Page.HeaderContent>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      {#if $isOrgAdmin === false}
        <p class="ui:text-muted-foreground text-sm">This report is available to admins only.</p>
      {:else if !r}
        <p class="ui:text-muted-foreground text-sm">Loading…</p>
      {:else}
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <ReportKpi label="Total events" value={r.totals.total} sub="matching the current filters" />
          <ReportKpi label="Errors" value={r.totals.errorsLast24h} sub="last 24 hours" />
          <ReportKpi label="Failed logins" value={r.totals.failedLoginsLast24h} sub="last 24 hours" />
        </div>

        <form
          class="bg-card mt-5 flex flex-wrap items-end gap-3 rounded-xl border p-4"
          onsubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <label class="flex flex-col gap-1 text-xs font-medium">
            From
            <input type="date" class={fieldClass} bind:value={fromDate} />
          </label>
          <label class="flex flex-col gap-1 text-xs font-medium">
            To
            <input type="date" class={fieldClass} bind:value={toDate} />
          </label>
          <label class="flex flex-col gap-1 text-xs font-medium">
            Event type
            <select class={fieldClass} bind:value={eventType}>
              <option value="">All</option>
              {#each EVENT_TYPES as t (t)}<option value={t}>{t}</option>{/each}
            </select>
          </label>
          <label class="flex flex-col gap-1 text-xs font-medium">
            Severity
            <select class={fieldClass} bind:value={severity}>
              <option value="">All</option>
              {#each SEVERITIES as s (s)}<option value={s}>{s}</option>{/each}
            </select>
          </label>
          <label class="flex flex-col gap-1 text-xs font-medium">
            HTTP status
            <Input type="text" inputmode="numeric" class="w-28" placeholder="e.g. 500" bind:value={status} />
          </label>
          <label class="flex flex-col gap-1 text-xs font-medium">
            Email
            <Input type="text" class="w-56" placeholder="contains…" bind:value={email} />
          </label>
          <Button type="submit" size="sm">Apply</Button>
          <Button type="button" variant="outline" size="sm" onclick={reset}>Reset</Button>
        </form>

        <div class="bg-card mt-5 rounded-xl border p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold">Events (newest first)</h3>
            <Button variant="outline" size="sm" onclick={exportRows} disabled={r.rows.length === 0}>
              <DownloadIcon class="size-4" /> Export CSV
            </Button>
          </div>
          <div class="overflow-x-auto rounded-md border">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Time (UTC)</Table.Head>
                  <Table.Head>Event type</Table.Head>
                  <Table.Head>Severity</Table.Head>
                  <Table.Head>User email</Table.Head>
                  <Table.Head>IP (masked)</Table.Head>
                  <Table.Head>Path</Table.Head>
                  <Table.Head class="text-right">Status</Table.Head>
                  <Table.Head>Message</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#if r.rows.length === 0}
                  <Table.Row>
                    <Table.Cell colspan={8} class="ui:text-muted-foreground py-8 text-center text-sm"
                      >No events match these filters.</Table.Cell
                    >
                  </Table.Row>
                {:else}
                  {#each r.rows as e (e.id)}
                    <Table.Row>
                      <Table.Cell class="whitespace-nowrap tabular-nums">{fmtTime(e.occurredAt)}</Table.Cell>
                      <Table.Cell class="font-medium whitespace-nowrap">{e.eventType}</Table.Cell>
                      <Table.Cell>{e.severity}</Table.Cell>
                      <Table.Cell>{e.userEmail ?? '—'}</Table.Cell>
                      <Table.Cell class="whitespace-nowrap">{e.ipMasked ?? '—'}</Table.Cell>
                      <Table.Cell class="max-w-xs break-all">{e.path ?? '—'}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{e.httpStatus ?? '—'}</Table.Cell>
                      <Table.Cell class="max-w-md break-words whitespace-pre-wrap">{e.message ?? '—'}</Table.Cell>
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
