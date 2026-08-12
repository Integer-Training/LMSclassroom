<script lang="ts">
  import UsersPage from '$features/users/pages/users.svelte';
</script>

<svelte:head>
  <title>Users — Pearl LMS</title>
</svelte:head>

<!-- Admin-only. The org/[slug] layout enforces requireAdmin server-side (Step 5); the API is
     requireAdmin too. Data is fetched client-side by usersApi. -->
<UsersPage />
