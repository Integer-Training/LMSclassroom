<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import * as Dialog from '@cio/ui/base/dialog';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { messagingApi, type MyLearner } from '$features/messaging/api/messaging.svelte';

  // Tutor "New message" picker: choose one of your allocated, active learners and open (or reuse) the thread.
  // The server enforces allocation on /messages/open — a stale or tampered pick comes back as a readable 403
  // that we show inline, then reload the roster so the list reflects reality.

  interface Props {
    open?: boolean;
  }
  let { open = $bindable(false) }: Props = $props();

  let query = $state('');
  let activeIndex = $state(0);
  let pickError = $state<string | null>(null);
  let pickingId = $state<string | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);

  const learners = $derived(messagingApi.myLearners);
  const loaded = $derived(messagingApi.myLearnersLoaded);
  const loadError = $derived(messagingApi.myLearnersError);
  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return learners;
    return learners.filter(
      (l) => (l.name ?? '').toLowerCase().includes(q) || (l.email ?? '').toLowerCase().includes(q)
    );
  });

  // Fresh roster each time the dialog opens.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      query = '';
      activeIndex = 0;
      pickError = null;
      pickingId = null;
      messagingApi.myLearnersLoaded = false;
      void messagingApi.loadMyLearners();
    });
    void tick().then(() => inputEl?.focus());
  });

  // Keep the highlighted row inside the list's range as the filter narrows.
  $effect(() => {
    const max = filtered.length - 1;
    untrack(() => {
      if (activeIndex > max) activeIndex = Math.max(0, max);
    });
  });

  function scrollActiveIntoView() {
    void tick().then(() => listEl?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
  }

  async function pick(learner: MyLearner) {
    if (pickingId || messagingApi.starting) return;
    pickError = null;
    pickingId = learner.learnerId;
    try {
      const res = await messagingApi.startConversation(learner.learnerId);
      if (!res) return;
      if ('error' in res) {
        pickError = res.error;
        // The roster may have changed (de-allocated mid-pick) — refresh it quietly.
        await messagingApi.loadMyLearners();
        return;
      }
      open = false;
      await goto(`/messages/${res.threadId}`);
    } finally {
      pickingId = null;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length) activeIndex = (activeIndex + 1) % filtered.length;
      scrollActiveIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length) activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
      scrollActiveIntoView();
    } else if (e.key === 'Home' && filtered.length) {
      e.preventDefault();
      activeIndex = 0;
      scrollActiveIntoView();
    } else if (e.key === 'End' && filtered.length) {
      e.preventDefault();
      activeIndex = filtered.length - 1;
      scrollActiveIntoView();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const learner = filtered[activeIndex];
      if (learner) void pick(learner);
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md [&>*]:min-w-0">
    <Dialog.Header>
      <Dialog.Title>New message</Dialog.Title>
      <Dialog.Description>Choose one of your learners to start a conversation.</Dialog.Description>
    </Dialog.Header>

    {#if !loaded && !loadError}
      <p class="text-muted-foreground py-6 text-center text-sm" role="status">Loading your learners…</p>
    {:else if loadError && !learners.length}
      <div class="flex flex-col items-center gap-2 py-4 text-center" role="alert">
        <p class="text-sm text-red-600">{loadError}</p>
        <Button variant="outline" size="sm" onclick={() => messagingApi.loadMyLearners()}>Retry</Button>
      </div>
    {:else if learners.length === 0}
      <p class="text-muted-foreground py-6 text-center text-sm">
        No learners are allocated to you yet. Once a learner is allocated to you, you can message them here.
      </p>
    {:else}
      <Input
        bind:ref={inputEl}
        bind:value={query}
        type="search"
        placeholder="Search learners…"
        autocomplete="off"
        role="combobox"
        aria-label="Search learners"
        aria-expanded="true"
        aria-controls="new-message-listbox"
        aria-activedescendant={filtered[activeIndex] ? `new-message-opt-${filtered[activeIndex].learnerId}` : undefined}
        onkeydown={onKeydown}
        oninput={() => (activeIndex = 0)}
      />

      {#if pickError}
        <p class="text-sm text-red-600" role="alert">{pickError}</p>
      {/if}

      {#if filtered.length === 0}
        <p class="text-muted-foreground py-4 text-center text-sm">No learners match "{query.trim()}".</p>
      {:else}
        <ul
          id="new-message-listbox"
          bind:this={listEl}
          role="listbox"
          aria-label="Your learners"
          class="max-h-72 divide-y overflow-y-auto rounded-md border"
        >
          {#each filtered as learner, i (learner.learnerId)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <li
              id="new-message-opt-{learner.learnerId}"
              role="option"
              aria-selected={i === activeIndex}
              aria-disabled={!!pickingId}
              class="hover:bg-muted/60 flex cursor-pointer flex-col gap-0.5 px-3 py-2 {i === activeIndex
                ? 'bg-muted'
                : ''} {pickingId && pickingId !== learner.learnerId ? 'opacity-50' : ''}"
              onclick={() => pick(learner)}
              onmousemove={() => (activeIndex = i)}
            >
              <span class="truncate text-sm font-medium">
                {learner.name || 'Learner'}
                {#if pickingId === learner.learnerId}<span class="text-muted-foreground text-xs font-normal">
                    Opening…</span
                  >{/if}
              </span>
              {#if learner.email}
                <span class="text-muted-foreground truncate text-xs">{learner.email}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </Dialog.Content>
</Dialog.Root>
