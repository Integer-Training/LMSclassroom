<script lang="ts">
  import { onMount } from 'svelte';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { Spinner } from '@cio/ui/base/spinner';
  import { Empty } from '@cio/ui/custom/empty';
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import LibraryBigIcon from '@lucide/svelte/icons/library-big';
  import UsersIcon from '@lucide/svelte/icons/users';
  import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
  import PaperclipIcon from '@lucide/svelte/icons/paperclip';
  import { caseloadApi } from '$features/caseload/api/caseload.svelte';

  // Tutor read-only course view (PearlLMS — courses-assigned phase). Renders the allocation-scoped
  // outline: units in order, each unit's materials (read-only) and its assessments with per-workbook
  // stats (submitted / needs grading / passed) and a link into the Moodle-style submissions grid.

  let { data }: { data: { courseId: string } } = $props();

  onMount(() => {
    caseloadApi.loadCourseContent(data.courseId);
  });

  const content = $derived(caseloadApi.courseContent);
  const units = $derived(content?.units ?? []);

  function formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
  }

  function submissionsHref(lessonId: string, assessmentKey: string): string {
    return `/caseload/courses/${data.courseId}/submissions?lessonId=${lessonId}&assessmentKey=${encodeURIComponent(assessmentKey)}`;
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
  <div class="flex flex-col gap-4">
    {#each units as unit (unit.lessonId)}
      <section class="bg-card rounded-lg border">
        <!-- Unit header -->
        <div class="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          {#if unit.sectionTitle}
            <span class="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              {unit.sectionTitle}
            </span>
            <span class="text-muted-foreground">·</span>
          {/if}
          <h2 class="text-base font-semibold">{unit.title}</h2>
          {#if unit.unitType}
            <Badge variant="outline" class="capitalize">{unit.unitType}</Badge>
          {/if}
        </div>

        <div class="space-y-3 p-4">
          <!-- Assessments -->
          {#if unit.assessments.length > 0}
            <div class="space-y-2">
              {#each unit.assessments as assessment (assessment.key)}
                <div
                  class="bg-background flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div class="min-w-0 space-y-1.5">
                    <div class="flex flex-wrap items-center gap-2">
                      <ClipboardListIcon size={16} class="text-muted-foreground shrink-0" />
                      <span class="font-medium">{assessment.name}</span>
                      <Badge variant="secondary" class="capitalize">{assessment.kind}</Badge>
                      {#if assessment.dueAt}
                        <span class="text-muted-foreground text-xs tabular-nums">
                          Due {formatDate(assessment.dueAt)}
                        </span>
                      {/if}
                    </div>
                    <div class="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" class="tabular-nums">{assessment.submitted} submitted</Badge>
                      {#if assessment.needsGrading > 0}
                        <Badge variant="warning" class="tabular-nums">{assessment.needsGrading} need grading</Badge>
                      {:else}
                        <Badge variant="outline" class="tabular-nums">0 need grading</Badge>
                      {/if}
                      {#if assessment.passed > 0}
                        <Badge variant="success" class="tabular-nums">{assessment.passed} passed</Badge>
                      {:else}
                        <Badge variant="outline" class="tabular-nums">0 passed</Badge>
                      {/if}
                    </div>
                  </div>
                  <div class="shrink-0">
                    <Button href={submissionsHref(unit.lessonId, assessment.key)} size="sm">
                      View submissions
                    </Button>
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-muted-foreground text-sm">No assessments in this unit.</p>
          {/if}

          <!-- Materials (read-only) -->
          {#if unit.materials.length > 0}
            <div class="border-t pt-3">
              <p class="text-muted-foreground mb-1.5 text-xs font-medium uppercase tracking-wide">Materials</p>
              <ul class="flex flex-wrap gap-x-4 gap-y-1">
                {#each unit.materials as material (material.key)}
                  <li class="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
                    <PaperclipIcon size={14} class="shrink-0" />
                    {material.name}
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      </section>
    {/each}
  </div>
{/if}
