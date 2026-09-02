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

  // Grading Outcomes (PearlLMS Phase 8). Donut of Pass vs Refer. Lazy-loaded client-only.
  interface Props {
    passCount: number;
    referCount: number;
    passRate: number | null;
  }

  let { passCount, referCount, passRate }: Props = $props();

  const chartConfig = {
    pass: { label: 'Pass', color: 'var(--chart-1)' },
    refer: { label: 'Refer', color: 'var(--chart-4)' }
  } satisfies ChartConfig;

  const chartData = $derived(
    [
      { key: 'pass', label: 'Pass', value: passCount, color: 'var(--chart-1)' },
      { key: 'refer', label: 'Refer', value: referCount, color: 'var(--chart-4)' }
    ].filter((d) => d.value > 0)
  );

  const hasData = $derived(chartData.length > 0);
</script>

<div class="bg-card flex min-h-[320px] w-full flex-col rounded-xl border p-4 md:p-5">
  <div class="mb-2">
    <h3 class="text-base font-semibold tracking-tight">Grading Outcomes</h3>
    <p class="text-muted-foreground mt-1 text-sm">
      {#if passRate !== null}Pass Rate {passRate}%{:else}Awaiting first graded submission{/if}
    </p>
  </div>

  <div class="flex h-full flex-1 flex-col justify-center">
    {#if browser && hasData}
      {#await loadChart() then C}
        <C.ChartContainer class="mx-auto h-[240px] w-full" config={chartConfig}>
          <C.PieChart data={chartData} key="key" label="label" value="value" c="color" innerRadius={60} />
          <C.ChartLegend items={chartData.map((d) => ({ label: d.label, color: d.color, value: d.value }))} />
        </C.ChartContainer>
      {/await}
    {:else if hasData}
      <div class="flex h-[240px] items-center justify-center">
        <Spinner class="text-muted-foreground size-6" />
      </div>
    {:else}
      <div class="text-muted-foreground flex h-[240px] items-center justify-center text-sm">
        Nothing graded yet
      </div>
    {/if}
  </div>
</div>
