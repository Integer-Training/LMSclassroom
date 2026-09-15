<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as Page from '@cio/ui/base/page';
  import { Skeleton } from '@cio/ui/base/skeleton';
  import { currentOrg } from '$lib/utils/store/org';
  import { adminDashboardApi } from '$features/admin-dashboard/api/admin-dashboard.svelte';
  import HeadlineTiles from '$features/admin-dashboard/components/headline-tiles.svelte';
  import AlertCards from '$features/admin-dashboard/components/alert-cards.svelte';
  import ChartsGrid from '$features/admin-dashboard/components/charts-grid.svelte';
  import OnlineUsersPanel from '$features/admin-dashboard/components/online-users-panel.svelte';
  import TutorPerformanceTable from '$features/admin-dashboard/components/tutor-performance-table.svelte';
  import CourseOverviewTable from '$features/admin-dashboard/components/course-overview-table.svelte';

  // Admin analytics dashboard (PearlLMS). Platform-wide overview: headline KPIs, alert cards, charts,
  // live "online now" panel (polled), and tutor/course tables. Loads client-side from the current org.

  const overview = $derived(adminDashboardApi.overview);
  const online = $derived(adminDashboardApi.online);

  let onlineTimer: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    const orgId = $currentOrg.id;
    if (orgId) {
      adminDashboardApi.loadOverview(orgId);
      adminDashboardApi.loadOnline(orgId);
      onlineTimer = setInterval(() => {
        if ($currentOrg.id) adminDashboardApi.loadOnline($currentOrg.id);
      }, 45000);
    }
  });

  onDestroy(() => {
    if (onlineTimer) clearInterval(onlineTimer);
  });
</script>

<svelte:head>
  <title>Admin Dashboard — Pearl LMS</title>
</svelte:head>

<Page.Root class="w-full">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>Admin Dashboard</Page.Title>
      <Page.Subtitle>Platform overview · {$currentOrg.name}</Page.Subtitle>
    </Page.HeaderContent>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      {#if !overview}
        <div class="space-y-4">
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {#each Array(5) as _, i (i)}
              <Skeleton class="h-28 w-full rounded-xl" />
            {/each}
          </div>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {#each Array(5) as _, i (i)}
              <Skeleton class="h-28 w-full rounded-xl" />
            {/each}
          </div>
          <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {#each Array(4) as _, i (i)}
              <Skeleton class="h-[320px] w-full rounded-xl" />
            {/each}
          </div>
        </div>
      {:else}
        <div class="space-y-6">
          <HeadlineTiles headline={overview.headline} />

          <AlertCards headline={overview.headline} />

          <ChartsGrid charts={overview.charts} />

          <OnlineUsersPanel {online} />

          <TutorPerformanceTable tutors={overview.tutors} />

          <CourseOverviewTable courses={overview.courses} />
        </div>
      {/if}
    {/snippet}
  </Page.Body>
</Page.Root>
