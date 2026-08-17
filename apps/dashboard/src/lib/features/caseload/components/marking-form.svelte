<script lang="ts">
  import * as Select from '@cio/ui/base/select';
  import { Button } from '@cio/ui/base/button';
  import { RESULT_VALUES, RESULT_LABELS } from '@cio/utils/constants';
  import { caseloadApi } from '$features/caseload/api/caseload.svelte';

  // Record a result on the LATEST, unmarked version of a unit (PearlLMS Phase 3 Step 5). Result values
  // come from config (RESULT_VALUES); feedback is one free-text field. The tutor assesses off-platform —
  // this only records the outcome. On success the parent reloads the learner detail.
  interface Props {
    submissionId: string;
    onMarked: () => void;
  }
  let { submissionId, onMarked }: Props = $props();

  const options = RESULT_VALUES.map((v) => ({ value: v, label: RESULT_LABELS[v] }));

  let result = $state<string>(RESULT_VALUES[0]);
  let feedback = $state('');
  let saving = $state(false);

  function label(v: string): string {
    return RESULT_LABELS[v as keyof typeof RESULT_LABELS] ?? v;
  }

  async function save() {
    saving = true;
    const ok = await caseloadApi.markResult(submissionId, result, feedback);
    saving = false;
    if (ok) {
      feedback = '';
      onMarked();
    }
  }
</script>

<div class="bg-muted/40 mt-2 space-y-3 rounded-md p-3">
  <p class="text-sm font-medium">Record result</p>
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
  <div class="space-y-1">
    <label for={`feedback-${submissionId}`} class="text-muted-foreground text-xs font-medium">Feedback</label>
    <textarea
      id={`feedback-${submissionId}`}
      class="border-input bg-background focus-visible:ring-ring min-h-[96px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:outline-none"
      placeholder="Written feedback for the learner…"
      bind:value={feedback}
    ></textarea>
  </div>
  <div class="flex justify-end">
    <Button onclick={save} loading={saving} disabled={saving}>Save result</Button>
  </div>
</div>
