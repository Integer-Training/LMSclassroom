<script lang="ts">
  import { onMount } from 'svelte';
  import { Badge } from '@cio/ui/base/badge';
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import { RESULT_LABELS, isPassingResult } from '@cio/utils/constants';
  import MarkingForm from '$features/caseload/components/marking-form.svelte';
  import { caseloadApi, type DetailFile } from '$features/caseload/api/caseload.svelte';

  function resultLabel(result: string | null): string {
    return result ? (RESULT_LABELS[result as keyof typeof RESULT_LABELS] ?? result) : '';
  }

  // Caseload learner detail (PearlLMS Phase 3 Step 4). Read-only version history per unit; files open
  // through the guarded coursework download endpoint. Server re-checks allocation for this learnerId.

  interface Props {
    learnerId: string;
  }
  let { learnerId }: Props = $props();

  onMount(() => caseloadApi.loadLearner(learnerId));

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString();
  }
  function formatSize(bytes: number | undefined): string {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${units[i]}`;
  }
  function open(courseId: string, lessonId: string, file: DetailFile) {
    caseloadApi.openFile(courseId, lessonId, file.key);
  }
</script>

<div class="mx-auto w-full max-w-4xl p-6">
  <a href="/caseload" class="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-sm">
    <ArrowLeftIcon class="size-4" /> Back to caseload
  </a>

  {#if !caseloadApi.detail}
    <p class="text-muted-foreground text-sm">{caseloadApi.isLoading ? 'Loading…' : 'Learner not found.'}</p>
  {:else}
    <div class="mb-6">
      <h1 class="text-xl font-semibold">{caseloadApi.detail.learner.name || 'Learner'}</h1>
      <p class="text-muted-foreground text-sm">{caseloadApi.detail.learner.email}</p>
    </div>

    {#if caseloadApi.detail.courses.length === 0}
      <div class="text-muted-foreground rounded-md border p-8 text-center text-sm">Nothing submitted yet.</div>
    {:else}
      <div class="space-y-6">
        {#each caseloadApi.detail.courses as course (course.courseId)}
          <div>
            <h2 class="text-muted-foreground mb-2 text-sm font-semibold tracking-wide uppercase">{course.title}</h2>
            <div class="space-y-4">
              {#each course.units as unit (unit.lessonId)}
                <div class="rounded-md border">
                  <div class="bg-muted/40 flex items-center justify-between gap-2 border-b px-4 py-2.5">
                    <span class="font-medium">{unit.title}</span>
                    <Badge variant={unit.state.awaitingMarking ? 'secondary' : 'outline'}>{unit.state.label}</Badge>
                  </div>
                  <ul class="divide-y">
                    {#each unit.submissions as sub, idx (sub.id)}
                      <li class="px-4 py-3">
                        <div class="mb-2 flex items-center justify-between gap-2">
                          <span class="text-sm font-medium">Version {sub.version}</span>
                          <div class="flex items-center gap-2">
                            {#if sub.result}
                              <Badge variant={isPassingResult(sub.result) ? 'default' : 'destructive'}>
                                {resultLabel(sub.result)}
                              </Badge>
                            {/if}
                            <span class="text-muted-foreground text-xs">{formatDate(sub.submittedAt)}</span>
                          </div>
                        </div>
                        <ul class="space-y-1">
                          {#each sub.files as file (file.key)}
                            <li>
                              <button
                                type="button"
                                class="ui:text-primary inline-flex items-center gap-1.5 text-sm hover:underline"
                                onclick={() => open(course.courseId, unit.lessonId, file)}
                              >
                                <FileTextIcon class="size-4 shrink-0" />
                                <span class="truncate">{file.name}</span>
                                {#if file.size}<span class="text-muted-foreground text-xs"
                                    >({formatSize(file.size)})</span
                                  >{/if}
                              </button>
                            </li>
                          {/each}
                        </ul>
                        {#if sub.feedback}
                          <div class="bg-muted/40 mt-2 rounded-md p-2.5">
                            <p class="text-muted-foreground mb-0.5 text-xs font-medium">Feedback</p>
                            <p class="text-sm whitespace-pre-wrap">{sub.feedback}</p>
                          </div>
                        {/if}
                        {#if idx === 0 && !sub.result}
                          <!-- Latest, unmarked version → record a result (allocated tutor / Admin). -->
                          <MarkingForm submissionId={sub.id} onMarked={() => caseloadApi.loadLearner(learnerId)} />
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>
