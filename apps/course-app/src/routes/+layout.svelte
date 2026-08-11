<script lang="ts">
  import { Toaster } from '$lib/components/ui/sonner';
  import { Navigation } from '$lib/components/navigation';

  // PostHog telemetry removed for privacy (PearlLMS fork).
  import '../app.css';

  let { children } = $props();
</script>

<Toaster />

<Navigation />

{@render children()}
