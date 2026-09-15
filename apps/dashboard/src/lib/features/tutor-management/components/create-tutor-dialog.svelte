<script lang="ts">
  import * as Dialog from '@cio/ui/base/dialog';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { tutorManagementApi } from '$features/tutor-management/api/tutor-management.svelte';
  import RevealPanel from '$features/learner-management/components/reveal-panel.svelte';

  // Create-tutor dialog. First/last name + email required. On success switches to a reveal panel with the
  // temporary password (shared reveal component).

  interface Props {
    open: boolean;
  }

  let { open = $bindable() }: Props = $props();

  let firstName = $state('');
  let lastName = $state('');
  let email = $state('');

  const canSubmit = $derived(!!firstName.trim() && !!lastName.trim() && !!email.trim() && !tutorManagementApi.creating);

  function resetForm() {
    firstName = '';
    lastName = '';
    email = '';
  }

  async function submit() {
    if (!canSubmit) return;
    await tutorManagementApi.createTutor({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim()
    });
  }

  function onOpenChange(next: boolean) {
    if (!next) {
      tutorManagementApi.clearRevealed();
      resetForm();
    }
  }
</script>

<Dialog.Root bind:open {onOpenChange}>
  <Dialog.Content class="sm:max-w-md">
    {#if tutorManagementApi.revealed}
      <Dialog.Header>
        <Dialog.Title>Tutor created</Dialog.Title>
      </Dialog.Header>

      <RevealPanel
        subject="Tutor"
        name={tutorManagementApi.revealed.name}
        password={tutorManagementApi.revealed.password}
      />

      <Dialog.Footer class="mt-4">
        <Button onclick={() => (open = false)}>Done</Button>
      </Dialog.Footer>
    {:else}
      <Dialog.Header>
        <Dialog.Title>New tutor</Dialog.Title>
        <Dialog.Description>Create a tutor account and reveal a temporary password.</Dialog.Description>
      </Dialog.Header>

      <div class="flex flex-col gap-3">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class="space-y-1">
            <label for="nt-first" class="text-sm font-medium">First name</label>
            <Input id="nt-first" bind:value={firstName} placeholder="Jane" maxlength={100} />
          </div>
          <div class="space-y-1">
            <label for="nt-last" class="text-sm font-medium">Last name</label>
            <Input id="nt-last" bind:value={lastName} placeholder="Doe" maxlength={100} />
          </div>
        </div>

        <div class="space-y-1">
          <label for="nt-email" class="text-sm font-medium">Email</label>
          <Input id="nt-email" type="email" bind:value={email} placeholder="jane@example.com" autocomplete="off" />
        </div>
      </div>

      <Dialog.Footer class="mt-4">
        <Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
        <Button onclick={submit} loading={tutorManagementApi.creating} disabled={!canSubmit}>Create tutor</Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
