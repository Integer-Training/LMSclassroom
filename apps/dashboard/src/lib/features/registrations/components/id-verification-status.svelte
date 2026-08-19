<script lang="ts">
  import { onMount } from 'svelte';
  import { idVerificationApi } from '$features/registrations/api/id-verification.svelte';
  import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
  import ShieldIcon from '@lucide/svelte/icons/shield';

  // PearlLMS Phase 7 Step 4 — the learner's OWN ID-verification status, shown on an id-check-typed unit
  // (informational only; gates nothing). Self-only: the endpoint derives it from the session actor — there is
  // no learner id here, so no one can see another learner's status.
  onMount(() => {
    if (!idVerificationApi.mine) void idVerificationApi.loadMine();
  });

  function fmt(dt: string | null): string {
    if (!dt) return '';
    try {
      return new Date(dt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
      return dt;
    }
  }
</script>

{#if idVerificationApi.mine}
  {#if idVerificationApi.mine.status === 'verified'}
    <div class="mb-4 flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
      <ShieldCheckIcon class="mt-0.5 size-4 shrink-0" />
      <span
        >Identity verified{idVerificationApi.mine.verifiedAt
          ? ` on ${fmt(idVerificationApi.mine.verifiedAt)}`
          : ''}.</span
      >
    </div>
  {:else}
    <div class="text-muted-foreground bg-muted/40 mb-4 flex items-start gap-2 rounded-md p-3 text-sm">
      <ShieldIcon class="mt-0.5 size-4 shrink-0" />
      <span>Not yet verified — your tutor will check your ID at induction.</span>
    </div>
  {/if}
{/if}
