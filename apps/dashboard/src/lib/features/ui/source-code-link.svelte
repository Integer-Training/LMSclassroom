<script lang="ts">
  import { env } from '$env/dynamic/public';

  // AGPL-3.0 compliance: the running app must offer its source to users. URL is
  // config-driven (runtime) so a deployment can point at its own fork mirror.
  const DEFAULT_SOURCE_REPO_URL = 'https://github.com/Integer-Training/LMSclassroom';

  let { class: className = '' }: { class?: string } = $props();

  const url = env.PUBLIC_SOURCE_REPO_URL || DEFAULT_SOURCE_REPO_URL;
</script>

<a
  href={url}
  target="_blank"
  rel="noopener noreferrer"
  class="text-muted-foreground hover:text-foreground text-xs hover:underline {className}"
>
  Source code (AGPL-3.0)
</a>
