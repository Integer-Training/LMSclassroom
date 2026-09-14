<script lang="ts">
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import type { TutorOutlineUnit } from '$features/caseload/api/caseload.svelte';

  // Tutor unit-by-unit navigation (PearlLMS). A sticky vertical list of the course's units, in order,
  // each linking to its own read-only unit page. The active unit is highlighted; a unit with work
  // awaiting marking shows a small amber dot.

  let {
    courseId,
    units,
    activeLessonId
  }: { courseId: string; units: TutorOutlineUnit[]; activeLessonId: string } = $props();

  function needsGradingTotal(unit: TutorOutlineUnit): number {
    return unit.assessments.reduce((sum, a) => sum + a.needsGrading, 0);
  }
</script>

<nav class="lg:bg-card lg:sticky lg:top-4 lg:rounded-lg lg:border">
  <div class="flex items-center justify-between gap-2 px-3 py-2.5 lg:border-b">
    <span class="text-xs font-semibold uppercase tracking-wide">Units</span>
    <a
      href={`/caseload/courses/${courseId}`}
      class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
    >
      <ArrowLeftIcon size={13} /> All units
    </a>
  </div>
  <ul class="max-h-[calc(100vh-8rem)] space-y-0.5 overflow-y-auto p-2">
    {#each units as unit (unit.lessonId)}
      {@const isActive = unit.lessonId === activeLessonId}
      {@const grading = needsGradingTotal(unit)}
      <li>
        <a
          href={`/caseload/courses/${courseId}/units/${unit.lessonId}`}
          class={`flex items-center gap-2 rounded-md border-l-2 px-2.5 py-2 text-sm transition-colors ${
            isActive
              ? 'bg-primary/10 text-primary border-primary font-medium'
              : 'hover:bg-accent/50 text-foreground border-transparent'
          }`}
          aria-current={isActive ? 'page' : undefined}
        >
          <span class="min-w-0 flex-1 truncate">{unit.title}</span>
          {#if unit.isOptional}
            <span
              class="bg-muted text-muted-foreground shrink-0 rounded px-1 py-0.5 text-[10px] font-medium uppercase"
            >
              Opt
            </span>
          {/if}
          {#if grading > 0}
            <span
              class="size-2 shrink-0 rounded-full bg-amber-500"
              title={`${grading} need grading`}
            ></span>
          {/if}
        </a>
      </li>
    {/each}
  </ul>
</nav>
