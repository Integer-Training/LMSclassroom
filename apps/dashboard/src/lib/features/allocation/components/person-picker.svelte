<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { Input } from '@cio/ui/base/input';
  import { Button } from '@cio/ui/base/button';
  import type { AssignablePerson } from '$features/allocation/api/allocation.svelte';

  // Async typeahead for the allocation form. Searches the server (max 20 rows) as the admin types — the
  // org's learners are never loaded as a whole list. Re-searches when `refreshKey` changes (e.g. the other
  // side of the pair was picked, so already-allocated people drop out of the results).

  interface Props {
    id: string;
    placeholder: string;
    selected: AssignablePerson | null;
    search: (query: string) => Promise<AssignablePerson[]>;
    refreshKey?: string;
  }

  let { id, placeholder, selected = $bindable(), search, refreshKey = '' }: Props = $props();

  let query = $state('');
  let results = $state<AssignablePerson[]>([]);
  let searching = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reqId = 0;

  function label(p: AssignablePerson): string {
    return p.name ? `${p.name} (${p.email})` : p.email;
  }

  async function run(q: string) {
    const mine = ++reqId;
    searching = true;
    const found = await search(q);
    if (mine !== reqId) return; // a newer keystroke superseded this one
    results = found;
    searching = false;
  }

  function onInput() {
    clearTimeout(timer);
    timer = setTimeout(() => run(query), 250);
  }

  // Load the first page of results when shown, and reload when the counterpart changes.
  $effect(() => {
    void refreshKey;
    if (!selected) untrack(() => run(query));
  });

  function clear() {
    selected = null;
    query = '';
  }

  onDestroy(() => clearTimeout(timer));
</script>

{#if selected}
  <div class="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
    <span class="truncate">{label(selected)}</span>
    <Button variant="ghost" size="sm" onclick={clear}>Change</Button>
  </div>
{:else}
  <Input {id} bind:value={query} oninput={onInput} {placeholder} autocomplete="off" />
  <div class="max-h-48 overflow-y-auto rounded-md border" role="listbox" aria-label={placeholder}>
    {#if results.length === 0}
      <p class="text-muted-foreground px-3 py-2 text-sm">{searching ? 'Searching…' : 'No matches.'}</p>
    {:else}
      {#each results as p (p.userId)}
        <button
          type="button"
          role="option"
          aria-selected="false"
          class="hover:bg-muted block w-full truncate px-3 py-2 text-left text-sm"
          onclick={() => (selected = p)}
        >
          {label(p)}
        </button>
      {/each}
    {/if}
  </div>
{/if}
