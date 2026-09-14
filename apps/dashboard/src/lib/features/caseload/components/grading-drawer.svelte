<script lang="ts">
  import * as Sheet from '@cio/ui/base/sheet';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { Textarea } from '@cio/ui/base/textarea';
  import FileIcon from '@lucide/svelte/icons/file';
  import UploadIcon from '@lucide/svelte/icons/upload';
  import XIcon from '@lucide/svelte/icons/x';
  import { RESULT_VALUES, RESULT_LABELS } from '@cio/utils/constants';
  import { caseloadApi, type SubmissionsGridRow } from '$features/caseload/api/caseload.svelte';
  import { snackbar } from '$features/ui/snackbar/store';

  // Grading drawer for the tutor submissions grid (PearlLMS — courses-assigned phase). Grades ONE
  // submission version. A DRAFT (submissionType === 'draft') gets feedback only (no verdict); a FINAL
  // gets a Pass/Refer verdict + feedback. The tutor may attach a marked-up workbook as feedback files.
  // On success it calls onGraded() (which reloads the grid) and closes.

  interface Props {
    open: boolean;
    row: SubmissionsGridRow | null;
    courseId: string;
    lessonId: string;
    submissionId: string | null;
    allowDrafts: boolean;
    onGraded: () => void;
  }
  let {
    open = $bindable(false),
    row,
    courseId,
    lessonId,
    submissionId,
    allowDrafts,
    onGraded
  }: Props = $props();

  // The version being graded (found by submissionId in the row's versions).
  const target = $derived(row && submissionId ? row.versions.find((v) => v.submissionId === submissionId) ?? null : null);
  const isDraft = $derived(!!target && target.submissionType === 'draft');

  // Files/comment shown belong to the target version when known, else the row's latest.
  const files = $derived(target?.files ?? row?.files ?? []);
  const learnerComment = $derived(target?.comment ?? row?.comment ?? null);

  let result = $state<string>(RESULT_VALUES[0]);
  let feedback = $state('');
  let selectedFiles = $state<File[]>([]);
  let saving = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);

  // Reset the form each time a new submission is targeted / the drawer opens.
  $effect(() => {
    if (open && submissionId) {
      result = RESULT_VALUES[0];
      feedback = target?.feedback ?? '';
      selectedFiles = [];
    }
  });

  function label(v: string): string {
    return RESULT_LABELS[v as keyof typeof RESULT_LABELS] ?? v;
  }

  function onFilesPicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    if (input.files) selectedFiles = [...selectedFiles, ...Array.from(input.files)];
    input.value = '';
  }
  function removeFile(idx: number) {
    selectedFiles = selectedFiles.filter((_, i) => i !== idx);
  }

  async function submit() {
    if (!submissionId) return;
    if (isDraft && !feedback.trim() && selectedFiles.length === 0) {
      snackbar.error('Draft feedback cannot be empty.');
      return;
    }
    saving = true;
    let meta = undefined;
    if (selectedFiles.length > 0) {
      meta = await caseloadApi.uploadFeedbackFiles(submissionId, selectedFiles);
      if (meta === null) {
        saving = false;
        return; // upload failed; snackbar already shown
      }
    }
    const ok = await caseloadApi.markResult(
      submissionId,
      isDraft ? undefined : result,
      feedback,
      meta ?? undefined
    );
    saving = false;
    if (ok) {
      open = false;
      onGraded();
    }
  }
</script>

<Sheet.Root bind:open>
  <Sheet.Content side="right" class="ui:w-full ui:sm:max-w-lg ui:overflow-y-auto">
    {#if row}
      <Sheet.Header>
        <Sheet.Title>Grade submission</Sheet.Title>
        <Sheet.Description>
          {row.learner.name}
          {#if isDraft}· Draft{:else}· Final{/if}
          {#if target}· Version {target.version}{/if}
        </Sheet.Description>
      </Sheet.Header>

      <div class="space-y-5 px-4 pb-6">
        <!-- Learner submission files -->
        <div class="space-y-1.5">
          <p class="text-muted-foreground text-xs font-medium uppercase tracking-wide">Submission files</p>
          {#if files.length > 0}
            <ul class="space-y-1">
              {#each files as file (file.key)}
                <li>
                  <button
                    type="button"
                    class="ui:text-primary inline-flex items-center gap-1.5 text-sm hover:underline"
                    onclick={() => caseloadApi.openFile(courseId, lessonId, file.key)}
                  >
                    <FileIcon size={14} />
                    {file.name}
                  </button>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="text-muted-foreground text-sm">No files.</p>
          {/if}
        </div>

        <!-- Learner comment -->
        {#if learnerComment}
          <div class="space-y-1.5">
            <p class="text-muted-foreground text-xs font-medium uppercase tracking-wide">Learner comment</p>
            <p class="bg-muted/40 rounded-md p-2.5 text-sm whitespace-pre-wrap">{learnerComment}</p>
          </div>
        {/if}

        <!-- Verdict (final only) -->
        {#if !isDraft}
          <div class="space-y-1.5">
            <p class="text-muted-foreground text-xs font-medium uppercase tracking-wide">Result</p>
            <div class="flex flex-wrap gap-2">
              {#each RESULT_VALUES as value (value)}
                <Button
                  type="button"
                  variant={result === value ? 'default' : 'outline'}
                  size="sm"
                  onclick={() => (result = value)}
                >
                  {label(value)}
                </Button>
              {/each}
            </div>
          </div>
        {:else if allowDrafts}
          <p class="text-muted-foreground text-xs">Drafts receive feedback only — no Pass/Refer verdict.</p>
        {/if}

        <!-- Feedback -->
        <div class="space-y-1.5">
          <label for="grade-feedback" class="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Feedback
          </label>
          <Textarea
            id="grade-feedback"
            class="ui:min-h-[110px]"
            placeholder={isDraft ? 'Feedback on this draft (no Pass/Refer)…' : 'Written feedback for the learner…'}
            bind:value={feedback}
          />
        </div>

        <!-- Feedback files -->
        <div class="space-y-1.5">
          <p class="text-muted-foreground text-xs font-medium uppercase tracking-wide">Feedback files</p>
          <input
            bind:this={fileInput}
            type="file"
            multiple
            accept=".pdf,.doc,.docx"
            class="hidden"
            onchange={onFilesPicked}
          />
          <Button type="button" variant="outline" size="sm" onclick={() => fileInput?.click()}>
            <UploadIcon size={16} class="mr-1" /> Attach marked-up file
          </Button>
          {#if selectedFiles.length > 0}
            <ul class="space-y-1 pt-1">
              {#each selectedFiles as file, i (file.name + i)}
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
        </div>
      </div>

      <Sheet.Footer>
        <Button variant="outline" onclick={() => (open = false)} disabled={saving}>Cancel</Button>
        <Button onclick={submit} loading={saving} disabled={saving || !submissionId}>
          {isDraft ? 'Send draft feedback' : 'Save result'}
        </Button>
      </Sheet.Footer>
    {/if}
  </Sheet.Content>
</Sheet.Root>
