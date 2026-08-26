<script lang="ts">
  import * as Select from '@cio/ui/base/select';
  import { Button } from '@cio/ui/base/button';
  import { RESULT_VALUES, RESULT_LABELS } from '@cio/utils/constants';
  import { caseloadApi } from '$features/caseload/api/caseload.svelte';

  // Record a result on the LATEST, unmarked version of a unit (PearlLMS Phase 3 Step 5). Result values
  // come from config (RESULT_VALUES); feedback is one free-text field. The tutor assesses off-platform —
  // this only records the outcome. On success the parent reloads the learner detail.
  import { snackbar } from '$features/ui/snackbar/store';

  // PearlLMS Phase 8 — a DRAFT gets feedback only (no verdict); a FINAL gets a Pass/Refer verdict + feedback.
  interface Props {
    submissionId: string;
    isDraft?: boolean;
    onMarked: () => void;
  }
  let { submissionId, isDraft = false, onMarked }: Props = $props();

  const options = RESULT_VALUES.map((v) => ({ value: v, label: RESULT_LABELS[v] }));

  let result = $state<string>(RESULT_VALUES[0]);
  let feedback = $state('');
  let saving = $state(false);

  function label(v: string): string {
    return RESULT_LABELS[v as keyof typeof RESULT_LABELS] ?? v;
  }

  async function save() {
    if (isDraft && !feedback.trim()) {
      snackbar.error('Draft feedback cannot be empty.');
      return;
    }
    saving = true;
    const ok = await caseloadApi.markResult(submissionId, isDraft ? undefined : result, feedback);
    saving = false;
    if (ok) {
      feedback = '';
      onMarked();
    }
  }
</script>

<div class="bg-muted/40 mt-2 space-y-3 rounded-md p-3">
  <p class="text-sm font-medium">{isDraft ? 'Draft feedback' : 'Record result'}</p>
  {#if !isDraft}
    <div class="space-y-1">
      <label for={`result-${submissionId}`} class="text-muted-foreground text-xs font-medium">Result</label>
      <Select.Root type="single" bind:value={result}>
        <Select.Trigger id={`result-${submissionId}`} class="ui:w-full">{label(result)}</Select.Trigger>
        <Select.Content>
          {#each options as opt (opt.value)}
            <Select.Item value={opt.value}>{opt.label}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
  {/if}
  <div class="space-y-1">
    <label for={`feedback-${submissionId}`} class="text-muted-foreground text-xs font-medium">Feedback</label>
    <textarea
      id={`feedback-${submissionId}`}
      class="border-input bg-background focus-visible:ring-ring min-h-[96px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:outline-none"
      placeholder={isDraft ? 'Feedback on this draft (no Pass/Refer)…' : 'Written feedback for the learner…'}
      bind:value={feedback}
    ></textarea>
  </div>
  <div class="flex justify-end">
    <Button onclick={save} loading={saving} disabled={saving}>
      {isDraft ? 'Send draft feedback' : 'Save result'}
    </Button>
  </div>
</div>
