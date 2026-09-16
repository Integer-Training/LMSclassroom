<script lang="ts">
  import * as Dialog from '@cio/ui/base/dialog';
  import { Button } from '@cio/ui/base/button';
  import { tutorManagementApi } from '$features/tutor-management/api/tutor-management.svelte';
  import CourseMultiselect from '$features/tutor-management/components/course-multiselect.svelte';

  // Manage the courses a tutor teaches. Loads the tutor's current assignments + the assignable course list,
  // and saves the exact selection (server reconciles). Assigning a course lets the tutor view progress and
  // mark coursework for every learner enrolled in it.

  interface Props {
    open: boolean;
    memberId: number | null;
    tutorName: string;
  }

  let { open = $bindable(), memberId, tutorName }: Props = $props();

  let selected = $state<string[] | null>(null);
  let loadedFor = $state<number | null>(null);

  // Load the tutor's courses when the dialog opens for a member (once per member).
  $effect(() => {
    if (open && memberId != null && loadedFor !== memberId) {
      loadedFor = memberId;
      selected = null;
      tutorManagementApi.loadTutorCourses(memberId);
    }
  });

  // Initialise the local selection from the loaded assignments (once, before the user edits).
  $effect(() => {
    const tc = tutorManagementApi.tutorCourses;
    if (open && tc && selected === null) selected = [...tc.assignedCourseIds];
  });

  function onOpenChange(next: boolean) {
    if (!next) {
      loadedFor = null;
      selected = null;
    }
  }

  async function save() {
    if (memberId == null || selected === null) return;
    const res = await tutorManagementApi.saveTutorCourses(memberId, selected);
    if (res) open = false;
  }
</script>

<Dialog.Root bind:open {onOpenChange}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Manage courses</Dialog.Title>
      <Dialog.Description>Choose the courses {tutorName} teaches.</Dialog.Description>
    </Dialog.Header>

    {#if selected === null || !tutorManagementApi.tutorCourses}
      <p class="ui:text-muted-foreground py-6 text-center text-sm">Loading…</p>
    {:else}
      <p class="ui:text-muted-foreground text-xs">
        The tutor can view progress and mark coursework for every learner enrolled in a selected course.
      </p>
      <CourseMultiselect
        courses={tutorManagementApi.tutorCourses.courses}
        bind:selected
        disabled={tutorManagementApi.coursesBusy}
      />
    {/if}

    <Dialog.Footer class="mt-4">
      <Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
      <Button onclick={save} loading={tutorManagementApi.coursesBusy} disabled={selected === null}>Save courses</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
