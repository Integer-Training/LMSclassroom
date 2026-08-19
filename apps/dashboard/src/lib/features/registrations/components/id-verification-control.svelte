<script lang="ts">
  import { onMount } from 'svelte';
  import { idVerificationApi } from '$features/registrations/api/id-verification.svelte';
  import {
    ID_VERIFICATION_STATUS,
    ID_VERIFICATION_METHODS,
    ID_VERIFICATION_STATUS_LABELS,
    ID_VERIFICATION_METHOD_LABELS
  } from '@cio/utils/constants';
  import { Button } from '@cio/ui/base/button';

  // PearlLMS Phase 7 Step 4 — staff (Manager/Admin or the allocated tutor) record a learner's ID check:
  // status, method, optional note. NO document is uploaded or stored — who/when/method only. The API
  // re-enforces the role + allocation rule.
  let { learnerId }: { learnerId: string } = $props();

  let status = $state<string>('not_verified');
  let method = $state<string>('');
  let note = $state<string>('');

  onMount(async () => {
    await idVerificationApi.loadForLearner(learnerId);
    const r = idVerificationApi.record;
    if (r) {
      status = r.status;
      method = r.method ?? '';
      note = r.note ?? '';
    }
  });

  async function save() {
    await idVerificationApi.recordFor(learnerId, { status, method: method || null, note: note.trim() || null });
  }

  const statuses = ID_VERIFICATION_STATUS.map((s) => ({ value: s, label: ID_VERIFICATION_STATUS_LABELS[s] }));
  const methods = ID_VERIFICATION_METHODS.map((m) => ({ value: m, label: ID_VERIFICATION_METHOD_LABELS[m] }));
</script>

<div class="rounded-lg border p-4">
  <h3 class="mb-1 font-medium">Identity verification</h3>
  <p class="text-muted-foreground mb-3 text-sm">
    Record that you have checked this learner's ID. No document is stored — just the outcome.
  </p>

  <div class="grid gap-3 sm:grid-cols-2">
    <label class="text-sm">
      <span class="text-muted-foreground mb-1 block">Status</span>
      <select class="border-input bg-background h-9 w-full rounded-md border px-2 text-sm" bind:value={status}>
        {#each statuses as s (s.value)}
          <option value={s.value}>{s.label}</option>
        {/each}
      </select>
    </label>

    <label class="text-sm">
      <span class="text-muted-foreground mb-1 block">ID sighted</span>
      <select class="border-input bg-background h-9 w-full rounded-md border px-2 text-sm" bind:value={method}>
        <option value="">— none —</option>
        {#each methods as m (m.value)}
          <option value={m.value}>{m.label}</option>
        {/each}
      </select>
    </label>
  </div>

  <label class="mt-3 block text-sm">
    <span class="text-muted-foreground mb-1 block">Note (optional)</span>
    <textarea class="border-input bg-background w-full rounded-md border px-3 py-2 text-sm" rows="2" bind:value={note}
    ></textarea>
  </label>

  <div class="mt-3">
    <Button size="sm" disabled={idVerificationApi.saving} onclick={save}>
      {idVerificationApi.saving ? 'Saving…' : 'Save ID verification'}
    </Button>
  </div>
</div>
