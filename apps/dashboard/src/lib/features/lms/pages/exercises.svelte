<script lang="ts">
  import { Chip } from '@cio/ui/custom/chip';
  import LockIcon from '@lucide/svelte/icons/lock';
  import { profile } from '$lib/utils/store/user';
  import { currentOrg } from '$lib/utils/store/org';
  import { lmsAssignmentsApi, type LearnerAssignment } from '$features/lms/api/assignments.svelte';
  import { MATERIAL_KIND_LABELS, RESULT_LABELS, type MaterialKind } from '@cio/utils/constants';

  // PearlLMS — the learner's coursework board: every workbook / case study / assignment across their
  // enrolled courses, bucketed by state. Sources GET /lms/assignments (self-scoped). Replaces the legacy
  // quiz "exercises" board (PearlLMS has no quizzes). Locked units appear under "To do" with a lock badge.

  // Plain (non-reactive) guard so resetting it after a failure doesn't retrigger the effect into a loop —
  // it only reloads when the profile/org actually changes (which also handles org-switch refetch).
  let loadedForOrg: string | null = null;

  interface Column {
    id: string;
    title: string;
    className: string;
    items: LearnerAssignment[];
  }

  const items = $derived(lmsAssignmentsApi.data?.items ?? []);

  const columns = $derived.by<Column[]>(() => {
    const cols: Column[] = [
      { id: 'todo', title: 'To do', className: 'text-blue-700 bg-blue-100', items: [] },
      { id: 'in_progress', title: 'In progress', className: 'text-yellow-700 bg-yellow-200', items: [] },
      { id: 'awaiting', title: 'Awaiting marking', className: 'text-orange-700 bg-orange-200', items: [] },
      { id: 'refer', title: 'Needs resubmission', className: 'text-[#E35353] bg-[#FDDFE4]', items: [] },
      { id: 'passed', title: 'Passed', className: 'text-green-700 bg-green-200', items: [] }
    ];
    for (const it of items) {
      if (it.state === 'passed') cols[4].items.push(it);
      else if (it.state === 'referred') cols[3].items.push(it);
      else if (it.state === 'awaiting_marking') cols[2].items.push(it);
      else if (it.state === 'draft' || it.state === 'draft_feedback') cols[1].items.push(it);
      else cols[0].items.push(it); // not_started (includes locked)
    }
    // In "To do", surface actionable (unlocked) items before locked ones.
    cols[0].items.sort((a, b) => Number(a.locked) - Number(b.locked));
    return cols;
  });

  const totalCount = $derived(items.length);

  function kindLabel(kind: string): string {
    return MATERIAL_KIND_LABELS[kind as MaterialKind] ?? 'Coursework';
  }
  function resultLabel(result: string | null): string {
    return result ? (RESULT_LABELS[result as keyof typeof RESULT_LABELS] ?? result) : '';
  }
  function lessonURL(item: LearnerAssignment): string {
    return `/courses/${item.courseId}/lessons/${item.lessonId}`;
  }

  interface DueInfo {
    label: string;
    tone: 'muted' | 'soon' | 'overdue';
  }
  function dueInfo(iso: string | null): DueInfo | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const ms = d.getTime() - Date.now();
    const days = Math.ceil(ms / 86_400_000);
    const label = d.toLocaleDateString();
    if (ms < 0) return { label, tone: 'overdue' };
    if (days <= 3) return { label, tone: 'soon' };
    return { label, tone: 'muted' };
  }

  $effect(() => {
    const profileId = $profile.id;
    const orgId = $currentOrg.id;
    if (!profileId || !orgId) return;
    if (loadedForOrg === orgId) return; // already loaded for this org
    loadedForOrg = orgId;
    // On failure, clear the guard so a later profile/org change retries (no auto-loop — guard is non-reactive).
    lmsAssignmentsApi.load().then((res) => {
      if (!res) loadedForOrg = null;
    });
  });
</script>

{#if lmsAssignmentsApi.loaded && totalCount === 0}
  <div class="flex h-[50vh] w-full flex-col items-center justify-center text-center">
    <p class="text-lg font-medium dark:text-white">No assessments yet</p>
    <p class="mt-1 max-w-md text-sm text-gray-500 dark:text-neutral-400">
      Workbooks and case studies from your courses will appear here as they become available.
    </p>
  </div>
{:else}
  <div class="flex w-full items-start overflow-x-auto pb-2">
    {#each columns as column (column.id)}
      <div
        class="mr-3 h-[70vh] max-w-[320px] min-w-[320px] overflow-hidden rounded-md border border-gray-50 bg-gray-100 p-3 dark:border-neutral-700 dark:bg-black"
      >
        <div class="mb-2 flex items-center gap-2">
          <p class="ml-1 text-sm font-medium dark:text-white">{column.title}</p>
          <Chip value={column.items.length} className={column.className} />
        </div>

        <div class="h-full space-y-2 overflow-y-auto pr-1 pb-6">
          {#each column.items as item (item.courseId + item.lessonId + (item.assessmentKey ?? ''))}
            {@const due = dueInfo(item.dueAt)}
            <div class="w-full rounded-md bg-white px-3 py-3 dark:bg-neutral-800">
              <!-- course -->
              <p class="mb-1 truncate text-xs text-gray-500 dark:text-neutral-400" title={item.courseTitle}>
                {item.courseTitle}
              </p>

              <!-- name + kind -->
              <div class="mb-1 flex items-start justify-between gap-2">
                <p class="text-sm font-semibold text-black dark:text-white">{item.name}</p>
                <span
                  class="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-neutral-700 dark:text-neutral-300"
                >
                  {kindLabel(item.kind)}
                </span>
              </div>

              <!-- unit -->
              <p class="mb-2 truncate text-xs text-gray-500 dark:text-neutral-400" title={item.unitTitle}>
                {item.unitTitle}
              </p>

              {#if item.locked}
                <p class="flex items-center gap-1 text-xs text-gray-500 dark:text-neutral-400">
                  <LockIcon size={12} />
                  {#if item.lockedByTitle}
                    Locked — pass “{item.lockedByTitle}” first
                  {:else}
                    Locked
                  {/if}
                </p>
              {:else}
                <!-- due date -->
                {#if due}
                  <p
                    class="text-xs {due.tone === 'overdue'
                      ? 'font-medium text-red-600 dark:text-red-400'
                      : due.tone === 'soon'
                        ? 'font-medium text-amber-600 dark:text-amber-400'
                        : 'text-gray-500 dark:text-neutral-400'}"
                  >
                    {due.tone === 'overdue' ? 'Overdue' : 'Due'} {due.label}
                  </p>
                {/if}

                <!-- verdict + feedback -->
                {#if item.state === 'referred' || item.state === 'passed'}
                  <p
                    class="mt-1 text-xs font-medium {item.state === 'passed'
                      ? 'text-green-700 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'}"
                  >
                    {resultLabel(item.result)}
                  </p>
                  {#if item.feedback}
                    <p class="mt-1 line-clamp-3 text-xs text-gray-600 dark:text-neutral-300" title={item.feedback}>
                      “{item.feedback}”
                    </p>
                  {/if}
                {:else if item.state === 'awaiting_marking'}
                  <p class="mt-1 text-xs text-gray-500 dark:text-neutral-400">
                    Submitted{item.latestVersion ? ` (v${item.latestVersion})` : ''} — awaiting your tutor
                  </p>
                {:else if item.state === 'draft_feedback'}
                  <p class="mt-1 text-xs font-medium text-yellow-700 dark:text-yellow-400">
                    Feedback ready — submit your final
                  </p>
                  {#if item.feedback}
                    <p class="mt-1 line-clamp-3 text-xs text-gray-600 dark:text-neutral-300" title={item.feedback}>
                      “{item.feedback}”
                    </p>
                  {/if}
                {:else if item.state === 'draft'}
                  <p class="mt-1 text-xs text-gray-500 dark:text-neutral-400">
                    Draft submitted — awaiting feedback
                  </p>
                {/if}

                <a
                  href={lessonURL(item)}
                  class="ui:text-primary mt-2 inline-block text-xs font-medium hover:underline"
                >
                  {item.state === 'not_started' ? 'Start →' : 'Open →'}
                </a>
              {/if}
            </div>
          {/each}

          {#if column.items.length === 0}
            <p class="px-1 py-4 text-center text-xs text-gray-400 dark:text-neutral-600">Nothing here</p>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
