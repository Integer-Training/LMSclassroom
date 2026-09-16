<script lang="ts">
  import { Checkbox } from '@cio/ui/base/checkbox';
  import type { CourseOption } from '$features/tutor-management/api/tutor-management.svelte';

  // A scrollable checkbox list of org courses. `selected` is a bindable array of courseIds.

  interface Props {
    courses: CourseOption[];
    selected: string[];
    disabled?: boolean;
  }

  let { courses, selected = $bindable(), disabled = false }: Props = $props();

  function toggle(courseId: string, checked: boolean) {
    if (checked) {
      if (!selected.includes(courseId)) selected = [...selected, courseId];
    } else {
      selected = selected.filter((id) => id !== courseId);
    }
  }
</script>

{#if courses.length === 0}
  <p class="ui:text-muted-foreground text-sm">No courses available yet.</p>
{:else}
  <div class="max-h-60 divide-y overflow-y-auto rounded-md border">
    {#each courses as c (c.courseId)}
      <label class="hover:bg-muted/50 flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
        <Checkbox
          {disabled}
          checked={selected.includes(c.courseId)}
          onCheckedChange={(v) => toggle(c.courseId, v === true)}
        />
        <span>{c.title ?? 'Untitled course'}</span>
      </label>
    {/each}
  </div>
{/if}
