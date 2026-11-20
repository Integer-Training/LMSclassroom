<script lang="ts">
  import { Button } from '@cio/ui/base/button';
  import FileIcon from '@lucide/svelte/icons/file';
  import UploadIcon from '@lucide/svelte/icons/upload';
  import XIcon from '@lucide/svelte/icons/x';
  import { snackbar } from '$features/ui/snackbar/store';
  import { getResolvedUploadLimits } from '$lib/utils/config/upload-limits-context';
  import {
    ALLOWED_DOCUMENT_ACCEPT,
    ALLOWED_DOCUMENT_TYPES_LABEL,
    MAX_PRESIGN_FILES,
    isAllowedDocumentFile
  } from '@cio/utils/validation/constants';

  // Shared tutor feedback-file picker (grading drawer + learner-page marking form). Validates with the same
  // allow-list, per-file size ceiling and file-count cap the server enforces on the feedback presign.
  // The parent owns the selected list via bind:files and uploads it on save.
  interface Props {
    files: File[];
  }
  let { files = $bindable([]) }: Props = $props();

  const maxFileBytes = getResolvedUploadLimits().documentBytes;
  let fileInput = $state<HTMLInputElement | null>(null);

  function onFilesPicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const accepted: File[] = [];
    for (const file of input.files ? Array.from(input.files) : []) {
      if (!isAllowedDocumentFile(file.name, file.type)) {
        snackbar.error(`"${file.name}" is not an accepted file type. Please upload ${ALLOWED_DOCUMENT_TYPES_LABEL}.`);
        continue;
      }
      if (file.size > maxFileBytes) {
        const mb = Math.round(maxFileBytes / 1024 / 1024);
        snackbar.error(`"${file.name}" is too large. The maximum file size is ${mb}MB.`);
        continue;
      }
      if (files.length + accepted.length >= MAX_PRESIGN_FILES) {
        snackbar.error(`"${file.name}" was not added — you can attach at most ${MAX_PRESIGN_FILES} files.`);
        break;
      }
      accepted.push(file);
    }
    if (accepted.length > 0) files = [...files, ...accepted];
    input.value = '';
  }
  function removeFile(idx: number) {
    files = files.filter((_, i) => i !== idx);
  }
</script>

<input
  bind:this={fileInput}
  type="file"
  multiple
  accept={ALLOWED_DOCUMENT_ACCEPT}
  class="hidden"
  onchange={onFilesPicked}
/>
<Button type="button" variant="outline" size="sm" onclick={() => fileInput?.click()}>
  <UploadIcon size={16} class="mr-1" /> Attach marked-up file
</Button>
{#if files.length > 0}
  <ul class="space-y-1 pt-1">
    {#each files as file, i (file.name + i)}
      <li class="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm">
        <span class="inline-flex min-w-0 items-center gap-1.5">
          <FileIcon size={14} class="shrink-0" />
          <span class="truncate">{file.name}</span>
        </span>
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Remove file"
          onclick={() => removeFile(i)}
        >
          <XIcon size={14} />
        </button>
      </li>
    {/each}
  </ul>
{/if}
