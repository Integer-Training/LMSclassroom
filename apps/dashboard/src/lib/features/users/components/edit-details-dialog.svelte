<script lang="ts">
  import { untrack } from 'svelte';
  import * as Dialog from '@cio/ui/base/dialog';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { snackbar } from '$features/ui/snackbar/store';
  import LearnerPiiForm from '$features/users/components/learner-pii-form.svelte';
  import { usersApi, EMPTY_LEARNER_PROFILE, type LearnerProfile } from '$features/users/api/users.svelte';

  // Admin "Edit details" for a tutor or learner: the display NAME (updates both name columns server-side)
  // and, for learners, the enrolment PII. Email is locked. Name is saved only if changed, then PII only if changed.

  interface Props {
    open: boolean;
    /** Organisation member id (what the details/profile endpoints take) — NOT the profile id. */
    memberId: number | null;
    name: string;
    email: string;
    isLearner: boolean;
    onDone?: () => void;
  }

  let { open = $bindable(), memberId, name, email, isLearner, onDone }: Props = $props();

  let nameValue = $state('');
  let profileForm = $state<LearnerProfile>({ ...EMPTY_LEARNER_PROFILE });
  let profileSnapshot = $state('');
  let profileLoading = $state(false);
  let busy = $state(false);

  // Re-seed only when the dialog opens for a member; the form state is written here, so it must not be tracked
  // (reading it would re-run this effect on every write — an update-depth loop).
  $effect(() => {
    if (!open || memberId == null) return;
    const id = memberId;
    const seedName = name;
    const learner = isLearner;
    untrack(() => {
      nameValue = seedName;
      profileForm = { ...EMPTY_LEARNER_PROFILE };
      profileSnapshot = JSON.stringify(profileForm);
      if (!learner) return;
      profileLoading = true;
      usersApi.getProfile(id).then((loaded) => {
        if (memberId !== id) return;
        profileForm = { ...EMPTY_LEARNER_PROFILE, ...loaded };
        profileSnapshot = JSON.stringify(profileForm);
        profileLoading = false;
      });
    });
  });

  const nameChanged = $derived(nameValue.trim() !== name.trim());
  const profileChanged = $derived(isLearner && !profileLoading && JSON.stringify(profileForm) !== profileSnapshot);

  async function submit() {
    if (memberId == null || busy) return;
    busy = true;
    try {
      if (nameChanged) {
        const ok = await usersApi.updateDetails(memberId, nameValue.trim());
        if (!ok) return;
      }
      if (profileChanged) {
        const ok = await usersApi.saveProfile(memberId, profileForm);
        if (!ok) return;
      }
      if (nameChanged && !profileChanged) snackbar.success('Details updated');
      open = false;
      onDone?.();
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[85vh] w-full max-w-md overflow-y-auto [&>*]:min-w-0">
    <Dialog.Header>
      <Dialog.Title>Edit details</Dialog.Title>
      <Dialog.Description>
        Update this {isLearner ? 'learner' : 'tutor'}'s name{isLearner ? ' and enrolment details' : ''}.
      </Dialog.Description>
    </Dialog.Header>
    <div class="space-y-3">
      <div class="space-y-1">
        <label for="edit-details-name" class="text-sm font-medium">Full name</label>
        <Input id="edit-details-name" bind:value={nameValue} maxlength={200} />
      </div>
      <div class="space-y-1">
        <label for="edit-details-email" class="text-sm font-medium">Email</label>
        <Input id="edit-details-email" value={email} disabled />
        <p class="ui:text-muted-foreground text-xs">Email can't be changed</p>
      </div>
      {#if isLearner}
        <LearnerPiiForm bind:form={profileForm} loading={profileLoading} />
      {/if}
      <Dialog.Footer class="pt-2">
        <Button variant="outline" onclick={() => (open = false)} disabled={busy}>Cancel</Button>
        <Button
          onclick={submit}
          loading={busy}
          disabled={busy || profileLoading || !nameValue.trim() || (!nameChanged && !profileChanged)}
        >
          Save
        </Button>
      </Dialog.Footer>
    </div>
  </Dialog.Content>
</Dialog.Root>
