<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '@cio/ui/base/button';
  import { Badge } from '@cio/ui/base/badge';
  import * as FileDropZone from '@cio/ui/custom/file-drop-zone';
  import type { FileRejectedReason } from '@cio/ui/custom/file-drop-zone';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import CheckCircleIcon from '@lucide/svelte/icons/circle-check';
  import { CloseButton } from '$features/ui';
  import { snackbar } from '$features/ui/snackbar/store';
  import { getResolvedUploadLimits } from '$lib/utils/config/upload-limits-context';
  import { RESULT_LABELS, isPassingResult } from '@cio/utils/constants';
  import { courseworkApi, type CourseworkFile } from '$features/course/api/coursework.svelte';

  function resultLabel(result: string | null): string {
    return result ? (RESULT_LABELS[result as keyof typeof RESULT_LABELS] ?? result) : '';
  }

  interface Props {
    courseId: string;
    lessonId: string;
  }
  let { courseId, lessonId }: Props = $props();

  const maxBytes = getResolvedUploadLimits().documentBytes;
  const MAX_FILES = 5;

  let selected = $state<File[]>([]);

  onMount(() => {
    courseworkApi.list(courseId, lessonId);
  });

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
    const ok = await courseworkApi.submit(courseId, lessonId, selected);
    if (ok) selected = [];
  }

  function openFile(file: CourseworkFile) {
    courseworkApi.openFile(courseId, lessonId, file.key);
  }
</script>

<section class="mt-8 border-t pt-6">
  <h2 class="mb-1 text-lg font-semibold">Coursework</h2>
  <p class="text-muted-foreground mb-4 text-sm">
    Upload your work for this unit. Each upload is saved as a new version — your tutor sees the latest.
  </p>

  <!-- Upload area — closed once the unit is passed (no further submissions) -->
  {#if !courseworkApi.canSubmit}
    <div class="mb-4 flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3">
      <CheckCircleIcon class="mt-0.5 size-4 shrink-0 text-green-600" />
      <p class="text-sm text-green-700">You have passed this unit. No further submissions are needed.</p>
    </div>
  {:else}
    <div class="mb-4">
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
            label="Drag & drop or click to choose your coursework"
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
            Submit coursework
          </Button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Confirmation of the most recent submission -->
  {#if courseworkApi.lastSubmitted}
    <div class="mb-4 flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3">
      <CheckCircleIcon class="mt-0.5 size-4 shrink-0 text-green-600" />
      <p class="text-sm text-green-700">
        Version {courseworkApi.lastSubmitted.version} submitted on {formatDate(
          courseworkApi.lastSubmitted.submittedAt
        )}.
      </p>
    </div>
  {/if}

  <!-- Version list, newest first -->
  <div>
    <h3 class="mb-2 text-sm font-medium">Your submissions</h3>
    {#if courseworkApi.submissions.length === 0}
      <p class="text-muted-foreground text-sm">
        {courseworkApi.isLoading ? 'Loading…' : 'You have not submitted any coursework for this unit yet.'}
      </p>
    {:else}
      <ul class="space-y-3">
        {#each courseworkApi.submissions as sub (sub.id)}
          <li class="rounded-md border p-3">
            <div class="mb-2 flex items-center justify-between gap-2">
              <span class="font-medium">Version {sub.version}</span>
              <div class="flex items-center gap-2">
                {#if sub.result}
                  <Badge variant={isPassingResult(sub.result) ? 'default' : 'destructive'}
                    >{resultLabel(sub.result)}</Badge
                  >
                {:else}
                  <Badge variant="secondary">Awaiting marking</Badge>
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
    {/if}
  </div>
</section>
