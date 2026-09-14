<script lang="ts">
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { Spinner } from '@cio/ui/base/spinner';
  import { Empty } from '@cio/ui/custom/empty';
  import FileIcon from '@lucide/svelte/icons/file';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
  import PlayIcon from '@lucide/svelte/icons/play';
  import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
  import { MATERIAL_KIND_LABELS, isAssessmentKind } from '@cio/utils/constants';
  import { caseloadApi } from '$features/caseload/api/caseload.svelte';
  import UnitsSidebar from '$features/caseload/components/units-sidebar.svelte';

  // Tutor read-only unit view (PearlLMS — unit-by-unit rebuild). A two-pane, learner-like page: a units
  // sidebar (left) + this unit's read-only content (right). All materials/briefs download through the
  // allocation-gated tutor endpoint (caseloadApi.openMaterial); note/videos render directly. No learner
  // lesson components (they read the singleton lesson/course stores and would 403 on tutor downloads).

  let { data }: { data: { courseId: string; lessonId: string } } = $props();

  // Sidebar outline: load once. Per-unit content: reload whenever the lessonId changes.
  $effect(() => {
    if (!caseloadApi.courseContent || caseloadApi.courseContent.courseId !== data.courseId) {
      caseloadApi.loadCourseContent(data.courseId);
    }
  });
  $effect(() => {
    const lid = data.lessonId;
    caseloadApi.loadUnitContent(data.courseId, lid);
  });

  const unit = $derived(caseloadApi.unitContent);
  const outlineUnits = $derived(caseloadApi.courseContent?.units ?? []);

  const documents = $derived(unit?.documents ?? []);
  const resources = $derived(documents.filter((d) => !isAssessmentKind(d.kind)));
  const assessments = $derived(documents.filter((d) => isAssessmentKind(d.kind)));
  const links = $derived(unit?.links ?? []);
  const videos = $derived(unit?.videos ?? []);

  const isEmpty = $derived(
    !!unit &&
      videos.length === 0 &&
      !unit.note &&
      resources.length === 0 &&
      links.length === 0 &&
      assessments.length === 0
  );

  function kindLabel(kind: string | null): string {
    return (kind && MATERIAL_KIND_LABELS[kind as keyof typeof MATERIAL_KIND_LABELS]) ?? 'Resource';
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
  }

  // Per-assessment stats live on the course outline (courseContent), keyed by unit lessonId + doc key.
  function assessmentStat(key: string) {
    const u = caseloadApi.courseContent?.units.find((x) => x.lessonId === data.lessonId);
    return u?.assessments.find((a) => a.key === key) ?? null;
  }

  function submissionsHref(assessmentKey: string): string {
    return `/caseload/courses/${data.courseId}/submissions?lessonId=${data.lessonId}&assessmentKey=${encodeURIComponent(assessmentKey)}`;
  }

  // Convert a YouTube watch / short URL to its /embed/ form; null if it isn't a recognisable YouTube URL.
  function youtubeEmbed(link: string | null): string | null {
    if (!link) return null;
    try {
      const u = new URL(link);
      const host = u.hostname.replace(/^www\./, '');
      if (host === 'youtu.be') {
        const id = u.pathname.slice(1);
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
      if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
        if (u.pathname === '/watch') {
          const id = u.searchParams.get('v');
          return id ? `https://www.youtube.com/embed/${id}` : null;
        }
        if (u.pathname.startsWith('/embed/')) return link;
        if (u.pathname.startsWith('/shorts/')) {
          const id = u.pathname.split('/')[2];
          return id ? `https://www.youtube.com/embed/${id}` : null;
        }
      }
      return null;
    } catch {
      return null;
    }
  }
</script>

<svelte:head>
  <title>{unit?.title ?? 'Unit'} — Pearl LMS</title>
</svelte:head>

<div class="grid gap-6 lg:grid-cols-[260px_1fr]">
  <!-- LEFT: units sidebar (stacks above content on narrow screens) -->
  <aside>
    {#if outlineUnits.length > 0}
      <UnitsSidebar courseId={data.courseId} units={outlineUnits} activeLessonId={data.lessonId} />
    {/if}
  </aside>

  <!-- RIGHT: current unit content -->
  <div class="min-w-0">
    {#if !unit}
      <div class="flex justify-center py-16"><Spinner /></div>
    {:else}
      <header class="mb-6">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-2xl font-semibold tracking-tight">{unit.title}</h1>
          {#if unit.unitType}
            <Badge variant="outline" class="capitalize">{unit.unitType}</Badge>
          {/if}
          {#if unit.isOptional}
            <Badge variant="secondary">Optional</Badge>
          {/if}
        </div>
      </header>

      {#if isEmpty}
        <Empty
          title="Nothing here yet"
          description="This unit has no content yet."
          icon={FolderOpenIcon}
          variant="page"
        />
      {:else}
        <div class="space-y-8">
          <!-- Videos -->
          {#if videos.length > 0}
            <section>
              <h2 class="mb-3 text-lg font-semibold">Videos</h2>
              <div class="space-y-4">
                {#each videos as video, i (i)}
                  {@const embed = youtubeEmbed(video.link)}
                  {#if embed}
                    <div class="bg-muted overflow-hidden rounded-lg border" style="aspect-ratio: 16 / 9;">
                      <iframe
                        src={embed}
                        title={video.fileName ?? 'Video'}
                        class="h-full w-full"
                        style="border: 0;"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowfullscreen
                      ></iframe>
                    </div>
                  {:else if video.link}
                    <a
                      href={video.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="bg-card hover:bg-accent/40 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors"
                    >
                      <PlayIcon size={16} class="text-primary shrink-0" />
                      {video.fileName || 'Video'}
                    </a>
                  {/if}
                {/each}
              </div>
            </section>
          {/if}

          <!-- Notes (admin-authored, trusted HTML — same as the learner view) -->
          {#if unit.note}
            <section>
              <h2 class="mb-3 text-lg font-semibold">Notes</h2>
              <div class="prose prose-sm dark:prose-invert max-w-none">
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                {@html unit.note}
              </div>
            </section>
          {/if}

          <!-- Materials (plain resources + external links) -->
          {#if resources.length > 0 || links.length > 0}
            <section>
              <h2 class="mb-3 text-lg font-semibold">Materials</h2>
              <div class="flex flex-col gap-2">
                {#each resources as doc (doc.key)}
                  <button
                    type="button"
                    class="bg-card hover:bg-accent/40 flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors"
                    onclick={() => caseloadApi.openMaterial(data.courseId, doc.key)}
                  >
                    <FileIcon size={18} class="text-muted-foreground shrink-0" />
                    <span class="min-w-0 flex-1 truncate text-sm font-medium">{doc.name}</span>
                    <Badge variant="outline" class="shrink-0">{kindLabel(doc.kind)}</Badge>
                    <DownloadIcon size={16} class="text-muted-foreground shrink-0" />
                  </button>
                {/each}
                {#each links as link (link.url)}
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="bg-card hover:bg-accent/40 flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors"
                  >
                    <ExternalLinkIcon size={18} class="text-muted-foreground shrink-0" />
                    <span class="min-w-0 flex-1 truncate text-sm font-medium">{link.label || link.url}</span>
                  </a>
                {/each}
              </div>
            </section>
          {/if}

          <!-- Assessments -->
          {#if assessments.length > 0}
            <section>
              <h2 class="mb-3 text-lg font-semibold">Assessments</h2>
              <div class="space-y-3">
                {#each assessments as doc (doc.key)}
                  {@const stat = assessmentStat(doc.key)}
                  <div class="bg-card rounded-lg border p-4">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div class="min-w-0 space-y-1.5">
                        <div class="flex flex-wrap items-center gap-2">
                          <ClipboardListIcon size={16} class="text-muted-foreground shrink-0" />
                          <span class="font-medium">{doc.name}</span>
                          <Badge variant="secondary">{kindLabel(doc.kind)}</Badge>
                          {#if doc.dueAt}
                            <span class="text-muted-foreground text-xs tabular-nums">
                              Due {formatDate(doc.dueAt)}
                            </span>
                          {/if}
                        </div>
                        {#if stat}
                          <div class="flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" class="tabular-nums">{stat.submitted} submitted</Badge>
                            {#if stat.needsGrading > 0}
                              <Badge variant="warning" class="tabular-nums">{stat.needsGrading} need grading</Badge>
                            {:else}
                              <Badge variant="outline" class="tabular-nums">0 need grading</Badge>
                            {/if}
                            {#if stat.passed > 0}
                              <Badge variant="success" class="tabular-nums">{stat.passed} passed</Badge>
                            {:else}
                              <Badge variant="outline" class="tabular-nums">0 passed</Badge>
                            {/if}
                          </div>
                        {/if}
                      </div>
                    </div>
                    <div class="mt-3 flex flex-wrap items-center gap-2">
                      <Button href={submissionsHref(doc.key)} size="sm">View submissions</Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onclick={() => caseloadApi.openMaterial(data.courseId, doc.key)}
                      >
                        <DownloadIcon size={16} class="mr-1" /> Download brief
                      </Button>
                    </div>
                  </div>
                {/each}
              </div>
            </section>
          {/if}
        </div>
      {/if}
    {/if}
  </div>
</div>
