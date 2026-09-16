<script lang="ts">
  import * as Dialog from '@cio/ui/base/dialog';
  import { Button } from '@cio/ui/base/button';
  import { adminManagementApi } from '$features/admin-management/api/admin-management.svelte';
  import RevealPanel from '$features/learner-management/components/reveal-panel.svelte';

  // Reveal shown after "Reset Password" — a regenerated temporary password for an existing admin.

  interface Props {
    open: boolean;
  }

  let { open = $bindable() }: Props = $props();

  function onOpenChange(next: boolean) {
    if (!next) adminManagementApi.clearRevealed();
  }
</script>

<Dialog.Root bind:open {onOpenChange}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Password reset</Dialog.Title>
      <Dialog.Description>A new temporary password has been generated.</Dialog.Description>
    </Dialog.Header>

    {#if adminManagementApi.revealed}
      <RevealPanel
        subject="Admin"
        name={adminManagementApi.revealed.name}
        password={adminManagementApi.revealed.password}
        verb="reset"
      />
    {/if}

    <Dialog.Footer class="mt-4">
      <Button onclick={() => (open = false)}>Done</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
