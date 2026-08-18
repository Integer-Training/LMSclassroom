<script lang="ts">
  import { tick } from 'svelte';
  import { Button } from '@cio/ui/base/button';
  import { Textarea } from '@cio/ui/base/textarea';
  import SendIcon from '@lucide/svelte/icons/send-horizontal';
  import LockIcon from '@lucide/svelte/icons/lock';
  import { messagingApi, type ThreadView } from '$features/messaging/api/messaging.svelte';

  // PearlLMS Phase 6 Step 4 — a tutor↔learner conversation. Text only (no attachment affordance anywhere).
  // Read-only when archived (reallocation) or when viewed by an Admin overseer. History oldest-first.

  interface Props {
    view: ThreadView;
  }
  let { view }: Props = $props();

  let draft = $state('');
  let listEl = $state<HTMLElement | null>(null);

  function fmt(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  async function submit() {
    const body = draft.trim();
    if (!body || !view.canWrite || messagingApi.sending) return;
    draft = '';
    await messagingApi.send(view.threadId, body);
    await tick();
    listEl?.scrollTo({ top: listEl.scrollHeight });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }
</script>

<div class="ui:border-border mx-auto flex h-[70vh] w-full max-w-2xl flex-col rounded-lg border">
  <div class="ui:border-border flex items-center justify-between border-b px-4 py-2">
    <span class="text-sm font-semibold">{view.counterpart.name}</span>
    {#if view.readOnly}
      <span class="ui:text-muted-foreground flex items-center gap-1 text-xs">
        <LockIcon size={12} />
        {view.archived ? 'Read-only (this conversation is archived)' : 'Read-only'}
      </span>
    {/if}
  </div>

  <div bind:this={listEl} class="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
    {#if view.messages.length === 0}
      <p class="ui:text-muted-foreground m-auto text-sm">No messages yet. Say hello.</p>
    {:else}
      {#each view.messages as m (m.id)}
        <div class="flex {m.mine ? 'justify-end' : 'justify-start'}">
          <div
            class="max-w-[80%] rounded-2xl px-3 py-1.5 text-sm {m.mine
              ? 'ui:bg-primary ui:text-primary-foreground'
              : 'ui:bg-muted'}"
          >
            <p class="break-words whitespace-pre-wrap">{m.body}</p>
            <p class="mt-0.5 text-[10px] {m.mine ? 'ui:text-primary-foreground/70' : 'ui:text-muted-foreground'}">
              {fmt(m.createdAt)}
            </p>
          </div>
        </div>
      {/each}
    {/if}
  </div>

  {#if view.canWrite}
    <div class="ui:border-border flex items-end gap-2 border-t px-3 py-2">
      <Textarea
        bind:value={draft}
        onkeydown={onKeydown}
        placeholder="Write a message…"
        rows={1}
        class="ui:min-h-9 max-h-32 flex-1 resize-none"
      />
      <Button size="icon" onclick={submit} disabled={!draft.trim() || messagingApi.sending} aria-label="Send">
        <SendIcon size={16} />
      </Button>
    </div>
  {:else}
    <div class="ui:border-border ui:text-muted-foreground border-t px-4 py-3 text-center text-xs">
      {view.archived
        ? 'This conversation is archived and can no longer receive messages.'
        : 'You cannot post to this conversation.'}
    </div>
  {/if}
</div>
