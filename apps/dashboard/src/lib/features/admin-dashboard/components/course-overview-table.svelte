<script lang="ts">
  import * as Table from '@cio/ui/base/table';
  import { Input } from '@cio/ui/base/input';
  import { Button } from '@cio/ui/base/button';
  import { Badge } from '@cio/ui/base/badge';
  import { Progress } from '@cio/ui/base/progress';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import { downloadCsv } from '$features/admin-dashboard/utils/export-csv';
  import type { AdminCourseRow } from '$features/admin-dashboard/api/admin-dashboard.svelte';

  interface Props {
    courses: AdminCourseRow[];
  }

  let { courses }: Props = $props();

  let search = $state('');

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter((c) => c.title.toLowerCase().includes(q));
  });

  function exportCsv() {
    downloadCsv(
      'course-overview',
      ['Course', 'Published', 'Enrolled', 'Active (30d)', 'Assessments', 'Completion %'],
      filtered.map((c) => [
        c.title,
        c.isPublished ? 'Yes' : 'No',
        c.enrolled,
        c.active30d,
        c.assessments,
        c.completionPercent
      ])
    );
  }
</script>

<div>
  <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
    <h2 class="text-lg font-semibold tracking-tight">Course Overview</h2>
    <div class="flex items-center gap-2">
      <Input placeholder="Search courses…" bind:value={search} class="h-9 w-48" />
      <Button variant="outline" size="sm" onclick={exportCsv} disabled={filtered.length === 0}>
        <DownloadIcon class="mr-1 size-4" /> Export CSV
      </Button>
    </div>
  </div>

  <div class="overflow-x-auto rounded-md border">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>Course</Table.Head>
          <Table.Head class="text-right">Enrolled</Table.Head>
          <Table.Head class="text-right">Active (30d)</Table.Head>
          <Table.Head class="text-right">Assessments</Table.Head>
          <Table.Head class="w-40">Completion</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#if filtered.length === 0}
          <Table.Row>
            <Table.Cell colspan={5} class="text-muted-foreground text-center text-sm">
              {courses.length === 0 ? 'No courses yet.' : 'No courses match your search.'}
            </Table.Cell>
          </Table.Row>
        {:else}
          {#each filtered as course (course.courseId)}
            <Table.Row>
              <Table.Cell class="font-medium">
                <span class="flex items-center gap-2">
                  {course.title}
                  {#if !course.isPublished}
                    <Badge variant="outline" class="text-muted-foreground">Draft</Badge>
                  {/if}
                </span>
              </Table.Cell>
              <Table.Cell class="text-right tabular-nums">{course.enrolled}</Table.Cell>
              <Table.Cell class="text-right tabular-nums">{course.active30d}</Table.Cell>
              <Table.Cell class="text-right tabular-nums">{course.assessments}</Table.Cell>
              <Table.Cell>
                <div class="flex items-center gap-2">
                  <Progress value={course.completionPercent} class="h-1.5" />
                  <span class="text-xs font-medium tabular-nums">{course.completionPercent}%</span>
                </div>
              </Table.Cell>
            </Table.Row>
          {/each}
        {/if}
      </Table.Body>
    </Table.Root>
  </div>
</div>
