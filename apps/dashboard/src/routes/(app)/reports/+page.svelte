<script lang="ts">
  import { onMount } from 'svelte';
  import * as Page from '@cio/ui/base/page';
  import { progressReportApi } from '$features/reports/api/progress-report.svelte';

  function fmtDate(iso: string | null): string {
    return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  }

  function onSelect(event: Event) {
    const courseId = (event.target as HTMLSelectElement).value;
    if (courseId) void progressReportApi.loadReport(courseId);
  }

  onMount(async () => {
    await progressReportApi.loadCourses();
    const first = progressReportApi.courses[0]?.courseId;
    if (first) await progressReportApi.loadReport(first);
  });
</script>

<svelte:head>
  <title>Learner progress</title>
</svelte:head>

<Page.Root class="mx-auto w-[92%] px-4 md:max-w-5xl">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>Learner progress</Page.Title>
      <!-- PearlLMS Phase 7 — Manager/Admin reach the approval queue from their landing. -->
      <a href="/registrations" class="ui:text-primary text-sm underline">Registrations →</a>
    </Page.HeaderContent>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      <div class="flex flex-col gap-4">
        <label class="flex items-center gap-2 text-sm">
          <span class="ui:text-muted-foreground">Course</span>
          <select
            class="ui:border ui:bg-background ui:border-border rounded-md px-2 py-1.5 text-sm"
            value={progressReportApi.selectedCourseId ?? ''}
            onchange={onSelect}
          >
            {#each progressReportApi.courses as course (course.courseId)}
              <option value={course.courseId}>{course.title ?? 'Untitled course'}</option>
            {/each}
          </select>
        </label>

        {#if progressReportApi.loadingReport}
          <p class="ui:text-muted-foreground text-sm">Loading…</p>
        {:else if progressReportApi.courses.length === 0}
          <p class="ui:text-muted-foreground text-sm">No courses to report on.</p>
        {:else if progressReportApi.rows.length === 0}
          <p class="ui:text-muted-foreground text-sm">No enrolled learners for this course.</p>
        {:else}
          <div class="ui:border ui:border-border overflow-x-auto rounded-lg">
            <table class="w-full text-left text-sm">
              <thead class="ui:bg-muted/50 ui:text-muted-foreground text-xs uppercase">
                <tr>
                  <th class="px-3 py-2 font-medium">Learner</th>
                  <th class="px-3 py-2 font-medium">Passed</th>
                  <th class="px-3 py-2 font-medium">Current position</th>
                  <th class="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {#each progressReportApi.rows as row (row.learnerId)}
                  <tr class="ui:border-border ui:border-t {row.completed ? 'ui:bg-primary/5' : ''}">
                    <td class="px-3 py-2 font-medium">{row.name}</td>
                    <td class="px-3 py-2 tabular-nums">{row.passed} / {row.total}</td>
                    <td class="ui:text-muted-foreground px-3 py-2">
                      {#if row.completed}
                        —
                      {:else if row.currentPosition}
                        Session {row.currentPosition.index} of {row.total}
                      {:else}
                        —
                      {/if}
                    </td>
                    <td class="px-3 py-2">
                      {#if row.completed}
                        <span class="ui:text-primary font-medium"
                          >Completed{row.completedAt ? ` · ${fmtDate(row.completedAt)}` : ''}</span
                        >
                      {:else}
                        <span class="ui:text-muted-foreground">In progress</span>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    {/snippet}
  </Page.Body>
</Page.Root>
