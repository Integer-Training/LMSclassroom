<script lang="ts">
  import { onMount } from 'svelte';
  import { Badge } from '@cio/ui/base/badge';
  import { Spinner } from '@cio/ui/base/spinner';
  import { Empty } from '@cio/ui/custom/empty';
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import LibraryBigIcon from '@lucide/svelte/icons/library-big';
  import UsersIcon from '@lucide/svelte/icons/users';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import { caseloadApi } from '$features/caseload/api/caseload.svelte';

  // Tutor read-only course view (PearlLMS — unit-by-unit rebuild). This page is now a compact UNITS
  // OVERVIEW: a flat, ordered list of units, each linking into its own read-only unit page. The old
  // single long-scroll page (every unit's content stacked) is replaced to stop the endless scroll.

  let { data }: { data: { courseId: string } } = $props();

  onMount(() => {
    caseloadApi.loadCourseContent(data.courseId);
  });

  const content = $derived(caseloadApi.courseContent);
  const units = $derived(content?.units ?? []);

  function needsGradingTotal(unit: (typeof units)[number]): number {
    return unit.assessments.reduce((sum, a) => sum + a.needsGrading, 0);
  }
</script>

<svelte:head>
  <title>{content?.title ?? 'Course'} — Pearl LMS</title>
</svelte:head>

<div class="mb-4">
  <a
    href="/caseload/courses"
    class="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
  >
    <ArrowLeftIcon size={16} /> My courses
  </a>
  {#if content}
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold tracking-tight">{content.title}</h1>
      <span class="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
        <UsersIcon size={16} />
        {content.participants} participant{content.participants === 1 ? '' : 's'}
      </span>
    </div>
  {/if}
</div>

{#if !content}
  <div class="flex justify-center py-16"><Spinner /></div>
{:else if units.length === 0}
  <Empty
    title="No units yet"
    description="This course has no units to review."
    icon={LibraryBigIcon}
    variant="page"
  />
{:else}
  <div class="flex flex-col gap-2">
    {#each units as unit (unit.lessonId)}
      {@const grading = needsGradingTotal(unit)}
      <a
        href={`/caseload/courses/${data.courseId}/units/${unit.lessonId}`}
        class="bg-card hover:border-primary/40 hover:bg-accent/40 group flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors"
      >
        <div class="min-w-0 flex-1 space-y-1.5">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="truncate text-base font-semibold">{unit.title}</h2>
            {#if unit.unitType}
              <Badge variant="outline" class="capitalize">{unit.unitType}</Badge>
            {/if}
            {#if unit.isOptional}
              <Badge variant="secondary">Optional</Badge>
            {/if}
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-muted-foreground text-xs tabular-nums">
              {unit.materials.length} material{unit.materials.length === 1 ? '' : 's'} ·
              {unit.assessments.length} assessment{unit.assessments.length === 1 ? '' : 's'}
            </span>
            {#if grading > 0}
              <span
                class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 tabular-nums dark:bg-amber-500/20 dark:text-amber-300"
              >
                {grading} need grading
              </span>
            {/if}
          </div>
        </div>
        <ChevronRightIcon
          size={18}
          class="text-muted-foreground group-hover:text-foreground shrink-0 transition-colors"
        />
      </a>
    {/each}
  </div>
{/if}
