<script lang="ts">
  import * as Page from '@cio/ui/base/page';
  import * as Table from '@cio/ui/base/table';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import { currentOrg } from '$lib/utils/store/org';
  import { adminDashboardApi } from '$features/admin-dashboard/api/admin-dashboard.svelte';
  import { downloadCsv } from '$features/admin-dashboard/utils/export-csv';
  import ReportKpi from '$features/reports/components/report-kpi.svelte';
  import BarList from '$features/reports/components/bar-list.svelte';

  // Courses report — enrolment, activity, assessments and completion per course. Off the admin-overview bundle.

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let loadedForOrg: string | null = null;
  $effect(() => {
    const orgId = $currentOrg.id;
    if (!orgId || loadedForOrg === orgId) return;
    loadedForOrg = orgId;
    adminDashboardApi.loadOverview(orgId).then((res) => {
      if (!res) loadedForOrg = null;
    });
  });

  const o = $derived(adminDashboardApi.overview);
  const courses = $derived(o?.courses ?? []);
  const totalEnrolled = $derived(courses.reduce((n, c) => n + c.enrolled, 0));
  const avgCompletion = $derived(
    courses.length ? Math.round(courses.reduce((n, c) => n + c.completionPercent, 0) / courses.length) : 0
  );

  function exportCourses() {
    if (!o) return;
    downloadCsv(
      `courses-${new Date().toISOString().slice(0, 10)}`,
      ['Course', 'Status', 'Enrolled', 'Active 30d', 'Assessments', 'Avg completion %'],
      courses.map((c) => [
        c.title,
        c.isPublished ? 'Published' : 'Draft',
        c.enrolled,
        c.active30d,
        c.assessments,
        c.completionPercent
      ])
    );
  }
</script>

<svelte:head><title>Courses Report</title></svelte:head>

<Page.Root class="w-full">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>Courses</Page.Title>
      <Page.Subtitle>Enrolment, activity and completion by course</Page.Subtitle>
    </Page.HeaderContent>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      {#if !o}
        <p class="ui:text-muted-foreground text-sm">Loading…</p>
      {:else}
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <ReportKpi label="Active courses" value={o.headline.activeCourses} />
          <ReportKpi label="Total courses" value={courses.length} />
          <ReportKpi label="Total enrolled" value={totalEnrolled} />
          <ReportKpi label="Avg completion" value={`${avgCompletion}%`} />
        </div>

        <div class="bg-card mt-5 rounded-xl border p-4">
          <h3 class="mb-3 text-sm font-semibold">Enrolments this year</h3>
          <BarList
            items={o.charts.enrollmentTrend.map((t) => ({
              label: MONTHS[t.month - 1] ?? String(t.month),
              value: t.count
            }))}
            labelWidth="w-10"
          />
        </div>

        <div class="bg-card mt-5 rounded-xl border p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold">By course</h3>
            <Button variant="outline" size="sm" onclick={exportCourses} disabled={courses.length === 0}>
              <DownloadIcon class="size-4" /> Export CSV
            </Button>
          </div>
          <div class="overflow-x-auto rounded-md border">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Course</Table.Head>
                  <Table.Head>Status</Table.Head>
                  <Table.Head class="text-right">Enrolled</Table.Head>
                  <Table.Head class="text-right">Active 30d</Table.Head>
                  <Table.Head class="text-right">Assessments</Table.Head>
                  <Table.Head class="text-right">Completion</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#if courses.length === 0}
                  <Table.Row>
                    <Table.Cell colspan={6} class="ui:text-muted-foreground py-8 text-center text-sm"
                      >No courses yet.</Table.Cell
                    >
                  </Table.Row>
                {:else}
                  {#each courses as c (c.courseId)}
                    <Table.Row>
                      <Table.Cell class="font-medium break-words">{c.title}</Table.Cell>
                      <Table.Cell>
                        {#if c.isPublished}
                          <Badge variant="secondary" class="text-emerald-600 dark:text-emerald-400">Published</Badge>
                        {:else}
                          <Badge variant="outline">Draft</Badge>
                        {/if}
                      </Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{c.enrolled}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{c.active30d}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{c.assessments}</Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{c.completionPercent}%</Table.Cell>
                    </Table.Row>
                  {/each}
                {/if}
              </Table.Body>
            </Table.Root>
          </div>
        </div>
      {/if}
    {/snippet}
  </Page.Body>
</Page.Root>
