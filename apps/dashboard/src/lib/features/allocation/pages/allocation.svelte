<script lang="ts">
  import { onMount } from 'svelte';
  import * as Table from '@cio/ui/base/table';
  import * as Dialog from '@cio/ui/base/dialog';
  import * as Select from '@cio/ui/base/select';
  import { Button } from '@cio/ui/base/button';
  import { allocationApi, type Allocation, type AssignablePerson } from '$features/allocation/api/allocation.svelte';

  // Tutor↔learner allocation management (PearlLMS Phase 3). Manager OR Admin server-side
  // (requireManagerOrAdmin). Allocations are PROVIDER-WIDE pairs — a tutor becomes staff only for the
  // learners allocated to them. The admin org shell is Admin-only today, so Admins reach this page;
  // the API already permits Managers for when a manager surface exists.

  let view = $state<'tutor' | 'learner'>('tutor');

  // Assign modal
  let assignOpen = $state(false);
  let aTutor = $state('');
  let aLearner = $state('');

  // Remove confirm modal
  let removeOpen = $state(false);
  let removeTarget = $state<Allocation | null>(null);

  onMount(() => {
    allocationApi.list();
    allocationApi.loadAssignable();
  });

  function personLabel(p: AssignablePerson): string {
    return p.name ? `${p.name} (${p.email})` : p.email;
  }
  function tutorLabel(id: string): string {
    const p = allocationApi.tutors.find((t) => t.userId === id);
    return p ? personLabel(p) : 'Select a tutor';
  }
  function learnerLabel(id: string): string {
    const p = allocationApi.learners.find((l) => l.userId === id);
    return p ? personLabel(p) : 'Select a learner';
  }

  // Group allocations for the two views. Key = the person being grouped by; rows = their counterparts.
  interface Group {
    id: string;
    name: string;
    email: string;
    rows: Allocation[];
  }
  const grouped = $derived.by<Group[]>(() => {
    const byId = new Map<string, Group>();
    for (const a of allocationApi.allocations) {
      const key = view === 'tutor' ? a.tutorId : a.learnerId;
      const name = (view === 'tutor' ? a.tutorName : a.learnerName) ?? '';
      const email = (view === 'tutor' ? a.tutorEmail : a.learnerEmail) ?? '';
      if (!byId.has(key)) byId.set(key, { id: key, name, email, rows: [] });
      byId.get(key)!.rows.push(a);
    }
    return [...byId.values()].sort((x, y) => (x.name || x.email).localeCompare(y.name || y.email));
  });

  async function submitAssign() {
    if (!aTutor || !aLearner) return;
    const ok = await allocationApi.create({ tutorId: aTutor, learnerId: aLearner });
    if (ok) {
      assignOpen = false;
      aTutor = '';
      aLearner = '';
    }
  }

  function openRemove(a: Allocation) {
    removeTarget = a;
    removeOpen = true;
  }
  async function submitRemove() {
    if (!removeTarget) return;
    const ok = await allocationApi.remove(removeTarget.id);
    if (ok) removeOpen = false;
  }
</script>

<div class="mx-auto w-full max-w-5xl p-6">
  <div class="mb-6 flex items-center justify-between gap-3">
    <div>
      <h1 class="text-xl font-semibold">Tutor allocation</h1>
      <p class="text-muted-foreground text-sm">
        Assign tutors to learners. A tutor can see a learner's coursework only where they are allocated.
      </p>
    </div>
    <Button onclick={() => (assignOpen = true)}>Assign tutor</Button>
  </div>

  <div class="mb-4 flex items-center gap-2">
    <Button variant={view === 'tutor' ? 'default' : 'outline'} size="sm" onclick={() => (view = 'tutor')}>
      By tutor
    </Button>
    <Button variant={view === 'learner' ? 'default' : 'outline'} size="sm" onclick={() => (view = 'learner')}>
      By learner
    </Button>
  </div>

  {#if allocationApi.allocations.length === 0}
    <div class="text-muted-foreground rounded-md border p-8 text-center text-sm">
      {allocationApi.isLoading ? 'Loading…' : 'No allocations yet. Assign a tutor to get started.'}
    </div>
  {:else}
    <div class="space-y-6">
      {#each grouped as g (g.id)}
        <div class="rounded-md border">
          <div class="bg-muted/40 border-b px-4 py-2.5">
            <p class="font-medium">{g.name || g.email}</p>
            {#if g.name}<p class="text-muted-foreground text-xs">{g.email}</p>{/if}
          </div>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>{view === 'tutor' ? 'Learner' : 'Tutor'}</Table.Head>
                <Table.Head>Email</Table.Head>
                <Table.Head class="text-right">Actions</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each g.rows as a (a.id)}
                <Table.Row>
                  <Table.Cell class="font-medium">
                    {(view === 'tutor' ? a.learnerName : a.tutorName) || '—'}
                  </Table.Cell>
                  <Table.Cell>{(view === 'tutor' ? a.learnerEmail : a.tutorEmail) || '—'}</Table.Cell>
                  <Table.Cell class="text-right">
                    <Button variant="ghost" size="sm" class="ui:text-destructive" onclick={() => openRemove(a)}>
                      Remove
                    </Button>
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Assign tutor to learner -->
<Dialog.Root bind:open={assignOpen}>
  <Dialog.Content class="w-full max-w-md">
    <Dialog.Header>
      <Dialog.Title>Assign tutor</Dialog.Title>
      <Dialog.Description
        >Pair a tutor with a learner. The pairing applies across all that learner's courses.</Dialog.Description
      >
    </Dialog.Header>
    <div class="space-y-3">
      <div class="space-y-1">
        <label for="assign-tutor" class="text-sm font-medium">Tutor</label>
        <Select.Root type="single" bind:value={aTutor}>
          <Select.Trigger id="assign-tutor" class="ui:w-full">{tutorLabel(aTutor)}</Select.Trigger>
          <Select.Content>
            {#each allocationApi.tutors as t (t.userId)}
              <Select.Item value={t.userId}>{personLabel(t)}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
      <div class="space-y-1">
        <label for="assign-learner" class="text-sm font-medium">Learner</label>
        <Select.Root type="single" bind:value={aLearner}>
          <Select.Trigger id="assign-learner" class="ui:w-full">{learnerLabel(aLearner)}</Select.Trigger>
          <Select.Content>
            {#each allocationApi.learners as l (l.userId)}
              <Select.Item value={l.userId}>{personLabel(l)}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <Button variant="outline" onclick={() => (assignOpen = false)} disabled={allocationApi.isLoading}>Cancel</Button
        >
        <Button onclick={submitAssign} loading={allocationApi.isLoading} disabled={!aTutor || !aLearner}>Assign</Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>

<!-- Remove allocation -->
<Dialog.Root bind:open={removeOpen}>
  <Dialog.Content class="w-full max-w-md">
    <Dialog.Header>
      <Dialog.Title>Remove allocation</Dialog.Title>
      <Dialog.Description>
        {removeTarget?.tutorName || removeTarget?.tutorEmail} will no longer be the allocated tutor for
        {removeTarget?.learnerName || removeTarget?.learnerEmail}. Their access to that learner's coursework ends.
      </Dialog.Description>
    </Dialog.Header>
    <div class="flex justify-end gap-2 pt-2">
      <Button variant="outline" onclick={() => (removeOpen = false)} disabled={allocationApi.isLoading}>Cancel</Button>
      <Button variant="destructive" onclick={submitRemove} loading={allocationApi.isLoading}>Remove</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
