<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '@cio/ui/base/button';
  import { Badge } from '@cio/ui/base/badge';
  import * as FileDropZone from '@cio/ui/custom/file-drop-zone';
  import type { FileRejectedReason } from '@cio/ui/custom/file-drop-zone';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import CheckCircleIcon from '@lucide/svelte/icons/circle-check';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
  import { CloseButton } from '$features/ui';
  import { snackbar } from '$features/ui/snackbar/store';
  import { getResolvedUploadLimits } from '$lib/utils/config/upload-limits-context';
  import { RESULT_LABELS, MATERIAL_KIND_LABELS, isPassingResult, type MaterialKind } from '@cio/utils/constants';
  import { courseworkApi, type CourseworkFile } from '$features/course/api/coursework.svelte';
  import { DocumentUploader } from '$lib/utils/services/courses/presign';

  // PearlLMS Phase 8 — a single ASSESSMENT item's card: download the brief, upload a Draft (feedback-only)
  // or Final (graded Pass/Refer), see every version's result, and resubmit if referred. Bound to one
  // assessment (lesson.documents[].key); reads the shared unit submission list, filtered to this item.
  interface AssessmentInfo {
    key: string;
    name: string;
    kind: string;
    dueAt: string | null;
    allowDrafts: boolean;
    briefLink?: string;
  }
  interface Props {
    courseId: string;
    lessonId: string;
    assessment: AssessmentInfo;
  }
  let { courseId, lessonId, assessment }: Props = $props();

  const maxBytes = getResolvedUploadLimits().documentBytes;
  const MAX_FILES = 5;
  const documentUploader = new DocumentUploader();

  let selected = $state<File[]>([]);
  let mode = $state<'draft' | 'final'>('final');

  onMount(() => {
    courseworkApi.ensureLoaded(courseId, lessonId);
  });

  // This assessment's submissions (the shared unit list is newest-version first).
  const mySubs = $derived(courseworkApi.submissions.filter((s) => s.assessmentKey === assessment.key));
  const latestFinal = $derived(mySubs.find((s) => s.submissionType === 'final') ?? null);
  const passed = $derived(
    !!latestFinal && latestFinal.resultKind === 'verdict' && isPassingResult(latestFinal.result)
  );
  const referred = $derived(
    !!latestFinal && latestFinal.resultKind === 'verdict' && !!latestFinal.result && !isPassingResult(latestFinal.result)
  );

  function resultLabel(result: string | null): string {
    return result ? (RESULT_LABELS[result as keyof typeof RESULT_LABELS] ?? result) : '';
  }
  function kindLabel(kind: string): string {
    return MATERIAL_KIND_LABELS[kind as MaterialKind] ?? 'Assessment';
  }
  function formatSize(bytes: number | undefined): string {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${units[i]}`;
  }
  function formatDate(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString();
  }
  function dueLabel(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
  }

  function addFiles(files: File[]) {
    const combined = [...selected, ...files].slice(0, MAX_FILES);
    const error = courseworkApi.validateFiles(combined, maxBytes);
    if (error) {
      snackbar.error(error);
      return;
    }
    selected = combined;
  }
  function removeFile(index: number) {
    selected = selected.filter((_, i) => i !== index);
  }
  function onFileRejected(opts: { reason: FileRejectedReason }) {
    if (opts.reason === 'Maximum file size exceeded') {
      snackbar.error(`The maximum file size is ${Math.round(maxBytes / 1024 / 1024)}MB.`);
    } else if (opts.reason === 'File type not allowed') {
      snackbar.error('Please upload PDF or Word (.doc, .docx).');
    } else {
      snackbar.error('That file could not be added.');
    }
  }

  async function submit() {
    if (selected.length === 0) return;
    const submissionType = assessment.allowDrafts ? mode : 'final';
    const ok = await courseworkApi.submit(courseId, lessonId, assessment.key, submissionType, selected);
    if (ok) selected = [];
  }
  function openFile(file: CourseworkFile) {
    courseworkApi.openFile(courseId, lessonId, file.key);
  }
  async function openBrief() {
    try {
      const { urls } = await documentUploader.getDownloadPresignedUrl([assessment.key], 'document', courseId);
      const url = urls[assessment.key] ?? assessment.briefLink;
      if (url) window.open(url, '_blank', 'noopener');
      else snackbar.error('Could not open the brief.');
    } catch {
      snackbar.error('Could not open the brief.');
    }
  }
</script>

<div class="border-border mb-5 rounded-lg border p-4">
  <!-- Header: name + kind + due date + download brief -->
  <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
    <div class="flex items-center gap-2">
      <FileTextIcon class="ui:text-muted-foreground size-5 shrink-0" />
      <div>
        <p class="font-semibold">{assessment.name}</p>
        <div class="text-muted-foreground flex items-center gap-2 text-xs">
          <span>{kindLabel(assessment.kind)}</span>
          {#if assessment.dueAt}<span>· Due {dueLabel(assessment.dueAt)}</span>{/if}
        </div>
      </div>
    </div>
    <Button variant="outline" size="sm" onclick={openBrief}>
      <DownloadIcon class="mr-1.5 size-4" /> Download brief
    </Button>
  </div>

  <!-- State banner -->
  {#if passed}
    <div class="mb-3 flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3">
      <CheckCircleIcon class="mt-0.5 size-4 shrink-0 text-green-600" />
      <p class="text-sm text-green-700">Passed. No further submissions are needed for this assessment.</p>
    </div>
  {:else if referred}
    <div class="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
      <RotateCcwIcon class="mt-0.5 size-4 shrink-0 text-amber-600" />
      <p class="text-sm text-amber-700">
        Your work was referred — please read the feedback below, revise, and submit a new version.
      </p>
    </div>
  {/if}

  <!-- Upload area — open unless this assessment is passed -->
  {#if !passed}
    {#if assessment.allowDrafts}
      <!-- Draft vs Final choice -->
      <div class="mb-3 inline-flex overflow-hidden rounded-md border text-sm">
        <button
          type="button"
          class={`px-3 py-1.5 ${mode === 'final' ? 'ui:bg-primary ui:text-primary-foreground font-medium' : 'ui:text-muted-foreground'}`}
          onclick={() => (mode = 'final')}
        >
          Final (graded)
        </button>
        <button
          type="button"
          class={`px-3 py-1.5 ${mode === 'draft' ? 'ui:bg-primary ui:text-primary-foreground font-medium' : 'ui:text-muted-foreground'}`}
          onclick={() => (mode = 'draft')}
        >
          Draft (feedback only)
        </button>
      </div>
    {/if}

    {#if selected.length > 0}
      <div class="mb-3 space-y-2">
        {#each selected as file, i (file.name + i)}
          <div class="border-border flex items-center gap-3 rounded-lg border p-3">
            <FileTextIcon class="ui:text-muted-foreground size-5 shrink-0" />
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{file.name}</p>
              <p class="text-muted-foreground text-xs">{formatSize(file.size)}</p>
            </div>
            <CloseButton onClick={() => removeFile(i)} />
          </div>
        {/each}
      </div>
    {/if}

    {#if selected.length < MAX_FILES}
      <FileDropZone.Root
        accept=".pdf,.doc,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
        maxFiles={MAX_FILES}
        fileCount={selected.length}
        maxFileSize={maxBytes}
        onUpload={addFiles}
        {onFileRejected}
      >
        <FileDropZone.Trigger
          label="Drag & drop or click to choose your answer"
          formatMaxFiles={() => `PDF or Word, up to ${MAX_FILES} files`}
          formatMaxFilesAndSize={(size) => `(up to ${size})`}
          formatMaxSize={(size) => `PDF or Word (${size})`}
        />
      </FileDropZone.Root>
    {/if}

    {#if courseworkApi.uploadError}
      <div class="mt-3 rounded-md border border-red-200 bg-red-50 p-3">
        <p class="text-sm text-red-600">{courseworkApi.uploadError}</p>
      </div>
    {/if}

    {#if selected.length > 0}
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="outline" onclick={() => (selected = [])} disabled={courseworkApi.isUploading}>Clear</Button>
        <Button onclick={submit} loading={courseworkApi.isUploading} disabled={courseworkApi.isUploading}>
          {assessment.allowDrafts && mode === 'draft' ? 'Submit draft' : 'Submit final'}
        </Button>
      </div>
    {/if}
  {/if}

  <!-- Version list, newest first -->
  {#if mySubs.length > 0}
    <div class="mt-4">
      <h4 class="text-muted-foreground mb-2 text-xs font-medium">Your submissions</h4>
      <ul class="space-y-3">
        {#each mySubs as sub (sub.id)}
          <li class="rounded-md border p-3">
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span class="flex items-center gap-2 font-medium">
                Version {sub.version}
                <Badge variant="outline">{sub.submissionType === 'draft' ? 'Draft' : 'Final'}</Badge>
              </span>
              <div class="flex items-center gap-2">
                {#if sub.resultKind === 'verdict' && sub.result}
                  <Badge variant={isPassingResult(sub.result) ? 'default' : 'destructive'}>
                    {resultLabel(sub.result)}
                  </Badge>
                {:else if sub.resultKind === 'draft'}
                  <Badge variant="secondary">Draft feedback</Badge>
                {:else}
                  <Badge variant="secondary">
                    Awaiting {sub.submissionType === 'draft' ? 'draft feedback' : 'marking'}
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
                    onclick={() => openFile(file)}
                  >
                    <FileTextIcon class="size-4 shrink-0" />
                    <span class="truncate">{file.name}</span>
                    {#if file.size}<span class="text-muted-foreground text-xs">({formatSize(file.size)})</span>{/if}
                  </button>
                </li>
              {/each}
            </ul>
            {#if sub.feedback}
              <div class="bg-muted/40 mt-2 rounded-md p-2.5">
                <p class="text-muted-foreground mb-0.5 text-xs font-medium">Tutor feedback</p>
                <p class="text-sm whitespace-pre-wrap">{sub.feedback}</p>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
