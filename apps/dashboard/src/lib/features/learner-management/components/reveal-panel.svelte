<script lang="ts">
  import { Button } from '@cio/ui/base/button';
  import CheckIcon from '@lucide/svelte/icons/check';
  import CopyIcon from '@lucide/svelte/icons/copy';

  // Shared credential-reveal panel. Shows a newly created / regenerated temporary password with a Copy
  // button. Email delivery is dormant, so the admin shares the password out-of-band.

  interface Props {
    name: string;
    password: string;
    verb?: string;
    subject?: string;
  }

  let { name, password, verb = 'created', subject = 'Learner' }: Props = $props();

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      copied = true;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1800);
    } catch {
      copied = false;
    }
  }
</script>

<div class="flex flex-col gap-3">
  <p class="text-sm font-medium">
    <span class="text-emerald-600 dark:text-emerald-400">✓</span>
    {subject}
    {verb} — <strong>{name}</strong>. Temporary password:
  </p>

  <div class="flex items-center gap-2">
    <code
      class="ui:bg-muted ui:border-border flex-1 rounded-md border px-3 py-2 font-mono text-sm break-all select-all"
    >
      {password}
    </code>
    <Button variant="outline" size="sm" onclick={copy} class="shrink-0">
      {#if copied}
        <CheckIcon class="size-4" /> Copied
      {:else}
        <CopyIcon class="size-4" /> Copy
      {/if}
    </Button>
  </div>

  <p class="ui:text-muted-foreground text-xs">Share this securely. They'll be asked to change it on first login.</p>
</div>
