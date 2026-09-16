<script lang="ts">
  import * as Dialog from '@cio/ui/base/dialog';
  import { Button } from '@cio/ui/base/button';
  import { learnerManagementApi } from '$features/learner-management/api/learner-management.svelte';
  import RevealPanel from './reveal-panel.svelte';

  // Reveal shown after "Send login" — a regenerated temporary password for an existing learner.

  interface Props {
    open: boolean;
  }

  let { open = $bindable() }: Props = $props();

  function onOpenChange(next: boolean) {
    if (!next) learnerManagementApi.clearRevealed();
  }
</script>

<Dialog.Root bind:open {onOpenChange}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Password reset</Dialog.Title>
      <Dialog.Description>A new temporary password has been generated.</Dialog.Description>
    </Dialog.Header>

    {#if learnerManagementApi.revealed}
      <RevealPanel
        name={learnerManagementApi.revealed.name}
        password={learnerManagementApi.revealed.password}
        verb="reset"
      />
    {/if}

    <Dialog.Footer class="mt-4">
      <Button onclick={() => (open = false)}>Done</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
