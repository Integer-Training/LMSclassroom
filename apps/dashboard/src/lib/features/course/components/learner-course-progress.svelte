<script lang="ts">
  import { Progress } from '@cio/ui/base/progress';
  import { CircleCheckIcon } from '$features/ui/icons';
  import { courseProgressApi } from '$features/course/api';

  // PearlLMS Phase 5 Step 3 — the learner's SINGLE notion of progress: result-derived passed/total over the
  // course's non-exempt units, the current-session pointer, and the completion date once done. This replaces
  // the stock self-asserted progress card for the student experience (docs/PROGRESS-MODEL.md §4).

  interface Props {
    courseId: string;
    class?: string;
  }

  let { courseId, class: className = '' }: Props = $props();

  const p = $derived(
    courseProgressApi.progress && courseProgressApi.courseId === courseId ? courseProgressApi.progress : null
  );
  const percent = $derived(p && p.total > 0 ? Math.round((p.passed / p.total) * 100) : 0);
  const completedDate = $derived(
    p?.completedAt
      ? new Date(p.completedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      : null
  );
</script>

{#if p && p.total > 0}
  <div class={className}>
    <div class="flex items-baseline justify-between gap-2">
      <span class="text-xs font-medium">Your progress</span>
      <span class="ui:text-primary text-xs font-semibold tabular-nums">{p.passed} of {p.total} passed</span>
    </div>
    <Progress value={percent} max={100} class="ui:h-1.5 mt-2" />
    {#if p.completed}
      <p class="ui:text-muted-foreground mt-2 flex items-center gap-1 text-[11px]">
        <CircleCheckIcon size={12} filled={true} />
        {completedDate ? `Completed on ${completedDate}` : 'Completed'}
      </p>
    {:else if p.currentPosition}
      <a
        href={`/courses/${courseId}/lessons/${p.currentPosition.lessonId}`}
        class="ui:text-muted-foreground hover:ui:text-foreground mt-2 block truncate text-[11px]"
      >
        You are on session {p.currentPosition.index} of {p.total}: {p.currentPosition.title ?? 'current session'}
      </a>
    {/if}
  </div>
{/if}
