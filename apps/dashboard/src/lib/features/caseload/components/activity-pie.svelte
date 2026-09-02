<script module lang="ts">
  function loadChart() {
    if (typeof window === 'undefined') return Promise.reject(new Error('browser-only'));
    return import('@cio/ui/base/chart');
  }
</script>

<script lang="ts">
  import { browser } from '$app/environment';
  import type { ChartConfig } from '@cio/ui/base/chart/types';
  import { Spinner } from '@cio/ui/base/spinner';

  // Learner Activity Distribution (PearlLMS Phase 8). Pie of active / inactive / never-logged-in /
  // suspended learners. Lazy-loaded client-only so the chart bundle stays out of SSR.
  interface Props {
    active: number;
    inactive: number;
    neverLoggedIn: number;
    suspended: number;
  }

  let { active, inactive, neverLoggedIn, suspended }: Props = $props();

  const chartConfig = {
    active: { label: 'Active', color: 'var(--chart-1)' },
    inactive: { label: 'Inactive', color: 'var(--chart-2)' },
    neverLoggedIn: { label: 'Never logged in', color: 'var(--chart-3)' },
    suspended: { label: 'Suspended', color: 'var(--chart-4)' }
  } satisfies ChartConfig;

  const chartData = $derived(
    [
      { key: 'active', label: 'Active', value: active, color: 'var(--chart-1)' },
      { key: 'inactive', label: 'Inactive', value: inactive, color: 'var(--chart-2)' },
      { key: 'neverLoggedIn', label: 'Never logged in', value: neverLoggedIn, color: 'var(--chart-3)' },
      { key: 'suspended', label: 'Suspended', value: suspended, color: 'var(--chart-4)' }
    ].filter((d) => d.value > 0)
  );

  const hasData = $derived(chartData.length > 0);
</script>

<div class="bg-card flex min-h-[320px] w-full flex-col rounded-xl border p-4 md:p-5">
  <div class="mb-2">
    <h3 class="text-base font-semibold tracking-tight">Learner Activity Distribution</h3>
    <p class="text-muted-foreground mt-1 text-sm">How your caseload is engaging</p>
  </div>

  <div class="flex h-full flex-1 flex-col justify-center">
    {#if browser && hasData}
      {#await loadChart() then C}
        <C.ChartContainer class="mx-auto h-[240px] w-full" config={chartConfig}>
          <C.PieChart data={chartData} key="key" label="label" value="value" c="color" innerRadius={-20} />
          <C.ChartLegend items={chartData.map((d) => ({ label: d.label, color: d.color, value: d.value }))} />
        </C.ChartContainer>
      {/await}
    {:else if hasData}
      <div class="flex h-[240px] items-center justify-center">
        <Spinner class="text-muted-foreground size-6" />
      </div>
    {:else}
      <div class="text-muted-foreground flex h-[240px] items-center justify-center text-sm">
        No learner activity yet
      </div>
    {/if}
  </div>
</div>
