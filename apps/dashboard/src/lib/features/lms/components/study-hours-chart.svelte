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
  import ClockIcon from '@lucide/svelte/icons/clock';

  // PearlLMS — the learner's study hours per month for the current year (from unit_time_monthly). Lazy,
  // client-only area chart mirroring the org login-activity chart. Data is zero-filled to 12 months upstream.
  interface Props {
    monthly: { month: number; seconds: number }[];
    totalSeconds: number;
    year: number;
  }
  let { monthly, totalSeconds, year }: Props = $props();

  const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const chartData = $derived(
    monthly.map((m) => ({
      month: MONTH_LABELS[m.month - 1] ?? String(m.month),
      hours: Math.round((m.seconds / 3600) * 10) / 10
    }))
  );

  const chartConfig = {
    hours: { label: 'Hours', color: 'var(--chart-1)' }
  } satisfies ChartConfig;

  const series = [{ key: 'hours', value: 'hours', label: 'Hours', color: 'var(--color-hours)' }];

  const hasData = $derived(monthly.some((m) => m.seconds > 0));

  function fmtTotal(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    if (h === 0 && m === 0) return '0h';
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
</script>

<div class="bg-card flex min-h-[320px] w-full flex-col rounded-xl border p-4 md:p-5">
  <div class="mb-3 flex items-center justify-between gap-2">
    <div>
      <h3 class="flex items-center gap-2 text-base font-semibold tracking-tight">
        <ClockIcon size={16} class="ui:text-muted-foreground" /> Study Hours
      </h3>
      <p class="text-muted-foreground mt-1 text-sm">
        {fmtTotal(totalSeconds)} total{hasData ? '' : ' — start a lesson to begin tracking'}
      </p>
    </div>
    <span
      class="text-muted-foreground border-border shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium"
    >
      {year}
    </span>
  </div>

  <div class="flex h-full flex-1 flex-col justify-center">
    {#if browser && hasData}
      {#await loadChart() then C}
        <C.ChartContainer class="h-[240px] w-full" config={chartConfig}>
          <C.AreaChart data={chartData} x="month" axis="x" {series} />
        </C.ChartContainer>
      {/await}
    {:else if hasData}
      <div class="flex h-[240px] items-center justify-center">
        <Spinner class="text-muted-foreground size-6" />
      </div>
    {:else}
      <div class="text-muted-foreground flex h-[240px] flex-col items-center justify-center gap-2 text-sm">
        <ClockIcon size={28} class="opacity-40" />
        No study time recorded yet this year.
      </div>
    {/if}
  </div>
</div>
