<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { currentOrg } from '$lib/utils/store/org';

  // The broadcast admin surface moved to the org-scoped /org/[slug]/broadcasts route (so it sits in the admin
  // sidebar). This legacy path just forwards there.
  onMount(() => {
    const slug = $currentOrg?.siteName;
    goto(slug ? resolve(`/org/${slug}/broadcasts`, {}) : resolve('/', {}));
  });
</script>

<p class="text-muted-foreground p-6 text-sm">Redirecting to Broadcasts…</p>
