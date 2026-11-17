<script lang="ts">
  import * as Dialog from '@cio/ui/base/dialog';
  import * as RadioGroup from '@cio/ui/base/radio-group';
  import { Button } from '@cio/ui/base/button';
  import PersonPicker from '$features/allocation/components/person-picker.svelte';
  import { allocationApi, type AssignablePerson } from '$features/allocation/api/allocation.svelte';

  // Admin "Switch tutor" for ONE learner. 0 tutors → plain Assign; 1 → replace that tutor; 2+ → pick which
  // tutor to replace first (the other stays). The switch is one atomic server call (old tutor loses access
  // now, new tutor takes over marking and can read past messages read-only). Nobody is notified.

  interface Props {
    open: boolean;
    learner: { id: string; name: string } | null;
    /** The learner's current tutors (oldest first). */
    tutors: { tutorId: string; name: string | null }[];
    onDone?: () => void;
  }

  let { open = $bindable(), learner, tutors, onDone }: Props = $props();

  let fromTutorId = $state('');
  let target = $state<AssignablePerson | null>(null);
  let reason = $state('');
  let busy = $state(false);

  const assignMode = $derived(tutors.length === 0);
  const fromTutor = $derived(tutors.find((t) => t.tutorId === fromTutorId) ?? null);
  const fromName = $derived(fromTutor?.name || 'The current tutor');
  const toName = $derived(target?.name || target?.email || 'The new tutor');

  // Reset the form each time the dialog opens (preselect when there is only one tutor to replace).
  $effect(() => {
    if (!open) return;
    fromTutorId = tutors.length === 1 ? tutors[0].tutorId : '';
    target = null;
    reason = '';
  });

  // Hides tutors the learner already has, so the current/co-tutor can't be picked.
  const searchTutors = (q: string) => allocationApi.searchPeople('tutor', q, learner?.id);

  const canSubmit = $derived(!!learner && !!target && (assignMode || !!fromTutorId));

  async function submit() {
    if (!learner || !target || busy) return;
    busy = true;
    try {
      if (assignMode) {
        const ok = await allocationApi.create({ tutorId: target.userId, learnerId: learner.id });
        if (ok) {
          open = false;
          onDone?.();
        }
        return;
      }
      const res = await allocationApi.switchTutor({
        learnerId: learner.id,
        fromTutorId,
        toTutorId: target.userId,
        reason: reason.trim() || undefined
      });
      if (res === 'ok' || res === 'stale') {
        open = false;
        onDone?.();
      }
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[85vh] w-full max-w-md overflow-y-auto [&>*]:min-w-0">
    <Dialog.Header>
      <Dialog.Title>{assignMode ? 'Assign tutor' : 'Switch tutor'}</Dialog.Title>
      <Dialog.Description>
        {learner?.name || 'This learner'}
        {assignMode ? 'has no tutor yet.' : 'moves to a different tutor.'}
      </Dialog.Description>
    </Dialog.Header>
    <div class="space-y-3">
      {#if tutors.length === 1}
        <p class="text-sm">Current tutor: <span class="font-medium">{tutors[0].name || 'Unnamed tutor'}</span></p>
      {:else if tutors.length > 1}
        <div class="space-y-1">
          <p class="text-sm font-medium">Which tutor to replace?</p>
          <RadioGroup.Root bind:value={fromTutorId} class="space-y-2">
            {#each tutors as t (t.tutorId)}
              <div class="flex items-center gap-2">
                <RadioGroup.Item value={t.tutorId} id={`switch-from-${t.tutorId}`} />
                <label for={`switch-from-${t.tutorId}`} class="text-sm">{t.name || 'Unnamed tutor'}</label>
              </div>
            {/each}
          </RadioGroup.Root>
          <p class="ui:text-muted-foreground text-xs">The other tutor stays with this learner.</p>
        </div>
      {/if}

      <div class="space-y-1">
        <label for="switch-new-tutor" class="text-sm font-medium">{assignMode ? 'Tutor' : 'New tutor'}</label>
        <PersonPicker
          id="switch-new-tutor"
          placeholder="Search tutors by name or email"
          bind:selected={target}
          search={searchTutors}
        />
      </div>

      {#if !assignMode}
        <div class="space-y-1">
          <label for="switch-reason" class="text-sm font-medium">Reason</label>
          <textarea
            id="switch-reason"
            bind:value={reason}
            maxlength={300}
            class="border-input bg-background focus-visible:ring-ring min-h-[72px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:outline-none"
          ></textarea>
          <p class="ui:text-muted-foreground text-xs">
            Optional — kept in the audit log; don't include personal details
          </p>
        </div>

        {#if target && fromTutorId}
          <p class="ui:bg-muted/40 rounded-md border p-3 text-sm">
            {fromName} loses access to this learner immediately. {toName} takes over their marking and can read past messages
            (read-only). Nobody is notified.
          </p>
        {/if}
      {/if}

      <Dialog.Footer class="pt-2">
        <Button variant="outline" onclick={() => (open = false)} disabled={busy}>Cancel</Button>
        <Button onclick={submit} loading={busy} disabled={!canSubmit || busy}>
          {assignMode ? 'Assign' : 'Switch tutor'}
        </Button>
      </Dialog.Footer>
    </div>
  </Dialog.Content>
</Dialog.Root>
