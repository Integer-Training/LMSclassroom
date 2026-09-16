<script lang="ts">
  import * as Dialog from '@cio/ui/base/dialog';
  import * as Select from '@cio/ui/base/select';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { learnerManagementApi } from '$features/learner-management/api/learner-management.svelte';
  import RevealPanel from './reveal-panel.svelte';

  // Create-learner dialog. First/last name + email + course + tutor are all REQUIRED — a learner is always
  // enrolled in a course and assigned a tutor. On success the dialog switches to a reveal panel showing the
  // temporary password.

  interface Props {
    open: boolean;
  }

  let { open = $bindable() }: Props = $props();

  let firstName = $state('');
  let lastName = $state('');
  let email = $state('');
  let courseId = $state('');
  let tutorId = $state('');

  const hasCourses = $derived(learnerManagementApi.options.courses.length > 0);
  const hasTutors = $derived(learnerManagementApi.options.tutors.length > 0);

  const canSubmit = $derived(
    !!firstName.trim() &&
      !!lastName.trim() &&
      !!email.trim() &&
      !!courseId &&
      !!tutorId &&
      !learnerManagementApi.creating
  );

  const courseLabel = $derived(
    courseId
      ? (learnerManagementApi.options.courses.find((c) => c.courseId === courseId)?.title ?? 'Course')
      : 'Select a course'
  );
  const tutorLabel = $derived(
    tutorId ? (learnerManagementApi.options.tutors.find((t) => t.id === tutorId)?.name ?? 'Tutor') : 'Select a tutor'
  );

  function resetForm() {
    firstName = '';
    lastName = '';
    email = '';
    courseId = '';
    tutorId = '';
  }

  async function submit() {
    if (!canSubmit) return;
    await learnerManagementApi.createLearner({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      courseId,
      tutorId
    });
  }

  function done() {
    open = false;
  }

  // When the dialog closes (via Done, overlay, or escape) clear the reveal + form so the next open starts fresh.
  function onOpenChange(next: boolean) {
    if (!next) {
      learnerManagementApi.clearRevealed();
      resetForm();
    }
  }
</script>

<Dialog.Root bind:open {onOpenChange}>
  <Dialog.Content class="sm:max-w-md">
    {#if learnerManagementApi.revealed}
      <Dialog.Header>
        <Dialog.Title>Learner created</Dialog.Title>
      </Dialog.Header>

      <RevealPanel name={learnerManagementApi.revealed.name} password={learnerManagementApi.revealed.password} />

      <Dialog.Footer class="mt-4">
        <Button onclick={done}>Done</Button>
      </Dialog.Footer>
    {:else}
      <Dialog.Header>
        <Dialog.Title>New learner</Dialog.Title>
        <Dialog.Description>Create a learner account and reveal a temporary password.</Dialog.Description>
      </Dialog.Header>

      <div class="flex flex-col gap-3">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class="space-y-1">
            <label for="nl-first" class="text-sm font-medium">First name</label>
            <Input id="nl-first" bind:value={firstName} placeholder="Jane" maxlength={100} />
          </div>
          <div class="space-y-1">
            <label for="nl-last" class="text-sm font-medium">Last name</label>
            <Input id="nl-last" bind:value={lastName} placeholder="Doe" maxlength={100} />
          </div>
        </div>

        <div class="space-y-1">
          <label for="nl-email" class="text-sm font-medium">Email</label>
          <Input id="nl-email" type="email" bind:value={email} placeholder="jane@example.com" autocomplete="off" />
        </div>

        <div class="space-y-1">
          <label for="nl-course" class="text-sm font-medium">Course <span class="text-red-500">*</span></label>
          <Select.Root type="single" bind:value={courseId}>
            <Select.Trigger id="nl-course" class="ui:w-full">{courseLabel}</Select.Trigger>
            <Select.Content>
              {#each learnerManagementApi.options.courses as course (course.courseId)}
                <Select.Item value={course.courseId}>{course.title ?? 'Untitled course'}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
          {#if !hasCourses}
            <p class="text-xs text-red-500">Create a published course first — a learner must be enrolled in one.</p>
          {/if}
        </div>

        <div class="space-y-1">
          <label for="nl-tutor" class="text-sm font-medium">Tutor <span class="text-red-500">*</span></label>
          <Select.Root type="single" bind:value={tutorId}>
            <Select.Trigger id="nl-tutor" class="ui:w-full">{tutorLabel}</Select.Trigger>
            <Select.Content>
              {#each learnerManagementApi.options.tutors as tutor (tutor.id)}
                <Select.Item value={tutor.id}>{tutor.name ?? tutor.email ?? 'Tutor'}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
          {#if !hasTutors}
            <p class="text-xs text-red-500">Create a tutor first — a learner must be assigned to one.</p>
          {/if}
        </div>
      </div>

      <Dialog.Footer class="mt-4">
        <Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
        <Button onclick={submit} loading={learnerManagementApi.creating} disabled={!canSubmit}>Create learner</Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
