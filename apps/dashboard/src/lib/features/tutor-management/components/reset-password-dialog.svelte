<script lang="ts">
  import * as Dialog from '@cio/ui/base/dialog';
  import { Button } from '@cio/ui/base/button';
  import { tutorManagementApi } from '$features/tutor-management/api/tutor-management.svelte';
  import RevealPanel from '$features/learner-management/components/reveal-panel.svelte';

  // Reveal shown after "Send login" — a regenerated temporary password for an existing tutor.

  interface Props {
    open: boolean;
  }

  let { open = $bindable() }: Props = $props();

  function onOpenChange(next: boolean) {
    if (!next) tutorManagementApi.clearRevealed();
  }
</script>

<Dialog.Root bind:open {onOpenChange}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Login details</Dialog.Title>
      <Dialog.Description>A new temporary password has been generated.</Dialog.Description>
    </Dialog.Header>

    {#if tutorManagementApi.revealed}
      <RevealPanel
        subject="Tutor"
        name={tutorManagementApi.revealed.name}
        password={tutorManagementApi.revealed.password}
        verb="reset"
      />
    {/if}

    <Dialog.Footer class="mt-4">
      <Button onclick={() => (open = false)}>Done</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
