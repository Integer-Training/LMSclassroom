<script lang="ts">
  import * as Dialog from '@cio/ui/base/dialog';
  import { Button } from '@cio/ui/base/button';
  import { Textarea } from '@cio/ui/base/textarea';
  import StarRating from './star-rating.svelte';
  import { tutorFeedbackApi } from '$features/lms/api/tutor-feedback.svelte';

  // The every-N-units feedback prompt. Overall rating is required; the three dimensions + comment are
  // optional. The feedback is admin-only (the tutor never sees it) — we say so, so learners answer honestly.
  // Not mandatory: "Not now" just closes it (the /lms layout re-prompts on the next login, up to 3 times).

  interface Props {
    open: boolean;
    tutorName: string;
  }

  let { open = $bindable(), tutorName }: Props = $props();

  let overall = $state(0);
  let communication = $state(0);
  let helpfulness = $state(0);
  let knowledge = $state(0);
  let comment = $state('');

  const canSubmit = $derived(overall > 0 && !tutorFeedbackApi.submitting);

  function reset() {
    overall = 0;
    communication = 0;
    helpfulness = 0;
    knowledge = 0;
    comment = '';
  }

  async function submit() {
    if (!canSubmit) return;
    const res = await tutorFeedbackApi.submit({
      overallRating: overall,
      communicationRating: communication || undefined,
      helpfulnessRating: helpfulness || undefined,
      knowledgeRating: knowledge || undefined,
      comment: comment.trim() || undefined
    });
    if (res?.success) {
      open = false;
      reset();
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>How is {tutorName} doing?</Dialog.Title>
      <Dialog.Description>
        Your feedback helps us support you better. It is private — only the Pearl admin team sees it, never your tutor.
        This is optional; close it and we'll ask again another time.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-3 py-2">
      <StarRating id="tf-overall" bind:value={overall} label="Overall" />
      <StarRating id="tf-comm" bind:value={communication} label="Communication & support" />
      <StarRating id="tf-help" bind:value={helpfulness} label="Helpfulness of feedback" />
      <StarRating id="tf-know" bind:value={knowledge} label="Subject knowledge" />
      <div class="space-y-1">
        <label for="tf-comment" class="text-sm font-medium">Comments (optional)</label>
        <Textarea
          id="tf-comment"
          bind:value={comment}
          maxlength={2000}
          rows={3}
          placeholder="Anything you'd like to add?"
        />
      </div>
      {#if tutorFeedbackApi.error}
        <p class="text-destructive text-sm">Sorry, that didn't save. Please try again.</p>
      {/if}
    </div>

    <Dialog.Footer class="mt-2">
      <Button variant="outline" onclick={() => (open = false)}>Not now</Button>
      <Button onclick={submit} loading={tutorFeedbackApi.submitting} disabled={!canSubmit}>Submit feedback</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
