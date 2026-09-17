<script lang="ts">
  import { onMount } from 'svelte';
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

  // Load once the org store is ready. On a fresh page load $currentOrg.id can still be empty when the page
  // mounts (the org is resolved by the layout load), so a one-shot onMount read left the dashboard stuck on
  // skeletons until a navigation repopulated it. A reactive $effect + a non-reactive guard fixes that (and
  // retries the overview on the next org change if a load fails).
  let loadedForOrg: string | null = null;
  $effect(() => {
    const orgId = $currentOrg.id;
    if (!orgId || loadedForOrg === orgId) return;
    loadedForOrg = orgId;
    adminDashboardApi.loadOverview(orgId).then((res) => {
      if (!res) loadedForOrg = null;
    });
    adminDashboardApi.loadOnline(orgId);
  });

  // Poll "online now" every 45s while mounted.
  onMount(() => {
    const timer = setInterval(() => {
      if ($currentOrg.id) adminDashboardApi.loadOnline($currentOrg.id);
    }, 45000);
    return () => clearInterval(timer);
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
