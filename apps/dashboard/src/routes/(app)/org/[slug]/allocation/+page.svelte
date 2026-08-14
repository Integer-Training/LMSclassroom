<script lang="ts">
  import AllocationPage from '$features/allocation/pages/allocation.svelte';
</script>

<svelte:head>
  <title>Tutor allocation — Pearl LMS</title>
</svelte:head>

<!-- The org/[slug] layout enforces requireAdmin server-side, so Admins reach this page. The API is
     requireManagerOrAdmin — it already permits Managers for a future manager surface. Data is fetched
     client-side by allocationApi. -->
<AllocationPage />
