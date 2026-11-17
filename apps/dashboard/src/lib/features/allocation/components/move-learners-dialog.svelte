<script lang="ts">
  import * as Dialog from '@cio/ui/base/dialog';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { Checkbox } from '@cio/ui/base/checkbox';
  import PersonPicker from '$features/allocation/components/person-picker.svelte';
  import {
    allocationApi,
    type AssignablePerson,
    type MoveResult,
    type TutorLearner
  } from '$features/allocation/api/allocation.svelte';

  // Admin bulk "Move learners": hand some or all of one tutor's learners to another tutor in a single
  // all-or-nothing batch. Same rules as a single switch (old tutor loses access now, nobody is notified).

  interface Props {
    open: boolean;
    /** The source tutor's profile id (not the member id). */
    tutorId: string | null;
    tutorName: string;
    onDone?: () => void;
  }

  let { open = $bindable(), tutorId, tutorName, onDone }: Props = $props();

  let learners = $state<TutorLearner[]>([]);
  let loading = $state(false);
  let selected = $state<Set<string>>(new Set());
  let filter = $state('');
  let target = $state<AssignablePerson | null>(null);
  let reason = $state('');
  let busy = $state(false);
  let result = $state<MoveResult | null>(null);

  // Load the tutor's learners each time the dialog opens, all selected by default.
  $effect(() => {
    if (!open || !tutorId) return;
    const id = tutorId;
    learners = [];
    selected = new Set();
    filter = '';
    target = null;
    reason = '';
    result = null;
    loading = true;
    allocationApi.tutorLearners(id).then((list) => {
      if (tutorId !== id) return;
      learners = list ?? [];
      selected = new Set(learners.map((l) => l.learnerId));
      loading = false;
    });
  });

  const visible = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return learners;
    return learners.filter((l) => `${l.name ?? ''} ${l.email ?? ''}`.toLowerCase().includes(q));
  });
  const allVisibleSelected = $derived(visible.length > 0 && visible.every((l) => selected.has(l.learnerId)));

  function toggle(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    selected = next;
  }
  function toggleAllVisible(on: boolean) {
    const next = new Set(selected);
    for (const l of visible) {
      if (on) next.add(l.learnerId);
      else next.delete(l.learnerId);
    }
    selected = next;
  }

  // The destination can't be the source tutor.
  const searchTutors = async (q: string) =>
    (await allocationApi.searchPeople('tutor', q)).filter((p) => p.userId !== tutorId);

  async function submit() {
    if (!tutorId || !target || selected.size === 0 || busy) return;
    busy = true;
    try {
      const everyone = selected.size === learners.length;
      const res = await allocationApi.moveLearners({
        fromTutorId: tutorId,
        toTutorId: target.userId,
        reason: reason.trim() || undefined,
        ...(everyone ? { all: true } : { learnerIds: [...selected] })
      });
      if (res) {
        result = res;
        onDone?.();
      }
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[90vh] w-full max-w-lg overflow-y-auto [&>*]:min-w-0">
    <Dialog.Header>
      <Dialog.Title>Move learners</Dialog.Title>
      <Dialog.Description>Move learners from {tutorName} to another tutor.</Dialog.Description>
    </Dialog.Header>

    {#if result}
      <div class="space-y-3">
        <div class="space-y-1 rounded-md border p-3 text-sm">
          <p class="font-medium">{result.moved} moved to {target?.name || target?.email || 'the new tutor'}</p>
          {#if result.alreadyWithTarget > 0}
            <p class="ui:text-muted-foreground">
              {result.alreadyWithTarget} already with that tutor (removed from {tutorName})
            </p>
          {/if}
          {#if result.notAllocated > 0}
            <p class="ui:text-muted-foreground">{result.notAllocated} no longer with {tutorName} (skipped)</p>
          {/if}
        </div>
        <Dialog.Footer class="pt-1">
          <Button onclick={() => (open = false)}>Done</Button>
        </Dialog.Footer>
      </div>
    {:else}
      <div class="space-y-3">
        <div class="space-y-1">
          <p class="text-sm font-medium">Learners ({selected.size} of {learners.length} selected)</p>
          <Input bind:value={filter} placeholder="Filter learners" autocomplete="off" aria-label="Filter learners" />
          <div class="flex items-center gap-2 py-1">
            <Checkbox
              id="move-select-all"
              checked={allVisibleSelected}
              disabled={visible.length === 0}
              onCheckedChange={(v) => toggleAllVisible(!!v)}
            />
            <label for="move-select-all" class="text-sm">Select all{filter.trim() ? ' shown' : ''}</label>
          </div>
          <div class="max-h-[50vh] overflow-y-auto rounded-md border">
            {#if loading}
              <p class="ui:text-muted-foreground px-3 py-2 text-sm">Loading…</p>
            {:else if visible.length === 0}
              <p class="ui:text-muted-foreground px-3 py-2 text-sm">No learners.</p>
            {:else}
              {#each visible as l (l.learnerId)}
                <div class="flex items-center gap-2 px-3 py-2">
                  <Checkbox
                    id={`move-${l.learnerId}`}
                    checked={selected.has(l.learnerId)}
                    onCheckedChange={(v) => toggle(l.learnerId, !!v)}
                  />
                  <label for={`move-${l.learnerId}`} class="min-w-0 flex-1 text-sm">
                    <span class="block truncate">{l.name || l.email || 'Learner'}</span>
                    {#if l.name && l.email}
                      <span class="ui:text-muted-foreground block truncate text-xs">{l.email}</span>
                    {/if}
                  </label>
                  {#if l.awaitingMarking > 0}
                    <span class="ui:text-muted-foreground shrink-0 text-xs">{l.awaitingMarking} to mark</span>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
        </div>

        <div class="space-y-1">
          <label for="move-target" class="text-sm font-medium">Move to</label>
          <PersonPicker
            id="move-target"
            placeholder="Search tutors by name or email"
            bind:selected={target}
            search={searchTutors}
          />
        </div>

        <div class="space-y-1">
          <label for="move-reason" class="text-sm font-medium">Reason</label>
          <textarea
            id="move-reason"
            bind:value={reason}
            maxlength={300}
            class="border-input bg-background focus-visible:ring-ring min-h-[72px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:outline-none"
          ></textarea>
          <p class="ui:text-muted-foreground text-xs">
            Optional — kept in the audit log; don't include personal details
          </p>
        </div>

        {#if target && selected.size > 0}
          <p class="ui:bg-muted/40 rounded-md border p-3 text-sm">
            {tutorName} loses access to {selected.size === 1 ? 'this learner' : `these ${selected.size} learners`}
            immediately. {target.name || target.email} takes over their marking and can read past messages (read-only). Nobody
            is notified.
          </p>
        {/if}

        <Dialog.Footer class="pt-2">
          <Button variant="outline" onclick={() => (open = false)} disabled={busy}>Cancel</Button>
          <Button onclick={submit} loading={busy} disabled={!target || selected.size === 0 || busy}>
            Move {selected.size}
            {selected.size === 1 ? 'learner' : 'learners'}
          </Button>
        </Dialog.Footer>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
