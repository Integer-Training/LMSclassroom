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
  import AnalyticsPanelCard from '$features/analytics/components/analytics-panel-card.svelte';
  import ActivityPie from '$features/caseload/components/activity-pie.svelte';
  import OutcomesDonut from '$features/caseload/components/outcomes-donut.svelte';
  import type { AdminCharts } from '$features/admin-dashboard/api/admin-dashboard.svelte';

  interface Props {
    charts: AdminCharts;
  }

  let { charts }: Props = $props();

  const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = (m: number) => MONTH_LABELS[m - 1] ?? String(m);

  // Enrollment (bar)
  const enrollmentData = $derived(charts.enrollmentTrend.map((d) => ({ month: monthLabel(d.month), count: d.count })));
  const enrollmentHasData = $derived(charts.enrollmentTrend.some((d) => d.count > 0));
  const enrollmentConfig = { count: { label: 'Enrollments', color: 'var(--chart-1)' } } satisfies ChartConfig;
  const enrollmentSeries = [{ key: 'count', value: 'count', label: 'Enrollments', color: 'var(--color-count)' }];

  // Submissions (bar)
  const submissionsData = $derived(
    charts.submissionsTrend.map((d) => ({ month: monthLabel(d.month), count: d.count }))
  );
  const submissionsHasData = $derived(charts.submissionsTrend.some((d) => d.count > 0));
  const submissionsConfig = { count: { label: 'Submissions', color: 'var(--chart-2)' } } satisfies ChartConfig;
  const submissionsSeries = [{ key: 'count', value: 'count', label: 'Submissions', color: 'var(--color-count)' }];

  // Study hours (area)
  const studyData = $derived(charts.studyHoursMonthly.map((d) => ({ month: monthLabel(d.month), hours: d.hours })));
  const studyHasData = $derived(charts.studyHoursMonthly.some((d) => d.hours > 0));
  const studyConfig = { hours: { label: 'Hours', color: 'var(--chart-1)' } } satisfies ChartConfig;
  const studySeries = [{ key: 'hours', value: 'hours', label: 'Hours', color: 'var(--color-hours)' }];
</script>

<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
  <!-- Learner Status Distribution -->
  <ActivityPie
    active={charts.learnerStatus.active}
    inactive={charts.learnerStatus.inactive}
    neverLoggedIn={charts.learnerStatus.neverLoggedIn}
    suspended={charts.learnerStatus.suspended}
  />

  <!-- Marking Outcomes -->
  <OutcomesDonut
    passCount={charts.outcomes.passCount}
    referCount={charts.outcomes.referCount}
    passRate={charts.outcomes.passRate}
  />

  <!-- Monthly Enrollment -->
  <AnalyticsPanelCard title="Monthly Enrollment" description="New enrollments per month">
    <div class="flex h-[260px] flex-col justify-center">
      {#if browser && enrollmentHasData}
        {#await loadChart() then C}
          <C.ChartContainer class="h-[240px] w-full" config={enrollmentConfig}>
            <C.BarChart data={enrollmentData} x="month" axis="x" series={enrollmentSeries} />
          </C.ChartContainer>
        {/await}
      {:else if enrollmentHasData}
        <div class="flex h-[240px] items-center justify-center">
          <Spinner class="text-muted-foreground size-6" />
        </div>
      {:else}
        <div class="text-muted-foreground flex h-[240px] items-center justify-center text-sm">No enrollments yet</div>
      {/if}
    </div>
  </AnalyticsPanelCard>

  <!-- Submissions Over Time -->
  <AnalyticsPanelCard title="Submissions Over Time" description="Submissions per month">
    <div class="flex h-[260px] flex-col justify-center">
      {#if browser && submissionsHasData}
        {#await loadChart() then C}
          <C.ChartContainer class="h-[240px] w-full" config={submissionsConfig}>
            <C.BarChart data={submissionsData} x="month" axis="x" series={submissionsSeries} />
          </C.ChartContainer>
        {/await}
      {:else if submissionsHasData}
        <div class="flex h-[240px] items-center justify-center">
          <Spinner class="text-muted-foreground size-6" />
        </div>
      {:else}
        <div class="text-muted-foreground flex h-[240px] items-center justify-center text-sm">No submissions yet</div>
      {/if}
    </div>
  </AnalyticsPanelCard>

  <!-- Study Hours (org-wide) -->
  <AnalyticsPanelCard title="Study Hours" description="Org-wide study hours per month" class="lg:col-span-2">
    <div class="flex h-[260px] flex-col justify-center">
      {#if browser && studyHasData}
        {#await loadChart() then C}
          <C.ChartContainer class="h-[240px] w-full" config={studyConfig}>
            <C.AreaChart data={studyData} x="month" axis="x" series={studySeries} />
          </C.ChartContainer>
        {/await}
      {:else if studyHasData}
        <div class="flex h-[240px] items-center justify-center">
          <Spinner class="text-muted-foreground size-6" />
        </div>
      {:else}
        <div class="text-muted-foreground flex h-[240px] items-center justify-center text-sm">
          No study time recorded yet
        </div>
      {/if}
    </div>
  </AnalyticsPanelCard>
</div>
