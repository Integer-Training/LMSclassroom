<script lang="ts">
  import { onMount } from 'svelte';
  import { CourseCard } from '@cio/ui';
  import { Search } from '@cio/ui/custom/search';
  import { Empty } from '@cio/ui/custom/empty';
  import LibraryBigIcon from '@lucide/svelte/icons/library-big';
  import { caseloadApi } from '$features/caseload/api/caseload.svelte';

  // Tutor course grid (PearlLMS Phase 8). Built from the allocation-scoped pipeline `programmes`
  // (courseId, title, learners) — the minimal shape CourseCard needs.
  let searchValue = $state('');

  onMount(() => {
    if (!caseloadApi.pipeline) caseloadApi.loadPipeline();
  });

  const programmes = $derived(caseloadApi.pipeline?.programmes ?? []);
  const filtered = $derived(
    programmes.filter((p) => p.title.toLowerCase().includes(searchValue.trim().toLowerCase()))
  );
</script>

<svelte:head>
  <title>My courses — Pearl LMS</title>
</svelte:head>

<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
  <h1 class="text-2xl font-semibold tracking-tight">My courses</h1>
  <Search placeholder="Search courses" bind:value={searchValue} />
</div>

{#if filtered.length === 0}
  <Empty
    title="No courses yet"
    description={searchValue
      ? 'No courses match your search.'
      : 'Courses appear here once learners are allocated to you.'}
    icon={LibraryBigIcon}
    variant="page"
  />
{:else}
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {#each filtered as prog (prog.courseId)}
      <!-- The card links to the tutor read-only course view (units + submissions grids). This route is
           allocation-scoped server-side (requireStaff) and reads only the caseload content API — it does
           NOT go through the admin course-editor layout, so a non-enrolled tutor is served correctly. -->
      <CourseCard title={prog.title} description="" href={`/caseload/courses/${prog.courseId}`}>
        {#snippet footer()}
          <div class="flex w-full items-center justify-between gap-2">
            <span class="text-muted-foreground text-sm">
              {prog.learners} learner{prog.learners === 1 ? '' : 's'}
            </span>
            <span class="text-primary text-xs font-medium">Open →</span>
          </div>
        {/snippet}
      </CourseCard>
    {/each}
  </div>
{/if}
