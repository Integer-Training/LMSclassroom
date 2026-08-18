<script lang="ts">
  import { Badge } from '@cio/ui/base/badge';
  import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
  import type { AnnouncementItem } from '$features/announcements/api/announcements.svelte';

  // PearlLMS Phase 6 Step 5 — a plain announcement list (title, body, scope, date). Read-only; publishing is
  // the staff compose surface. Shown on the learner home (provider-wide + enrolled) and the staff manage view.

  interface Props {
    items: AnnouncementItem[];
    showScope?: boolean;
    emptyText?: string;
  }
  let { items, showScope = true, emptyText = 'No announcements yet.' }: Props = $props();

  function fmt(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
</script>

{#if items.length === 0}
  <p class="ui:text-muted-foreground text-sm">{emptyText}</p>
{:else}
  <ul class="flex flex-col gap-3">
    {#each items as a (a.id)}
      <li class="ui:border-border rounded-lg border p-3">
        <div class="mb-1 flex items-center justify-between gap-2">
          <span class="flex items-center gap-2 text-sm font-semibold">
            <MegaphoneIcon size={14} class="ui:text-muted-foreground shrink-0" />
            {a.title}
          </span>
          <span class="flex shrink-0 items-center gap-2">
            {#if showScope}
              <Badge variant={a.scope === 'provider-wide' ? 'secondary' : 'outline'}>
                {a.scope === 'provider-wide' ? 'Everyone' : 'Course'}
              </Badge>
            {/if}
            <span class="ui:text-muted-foreground text-xs">{fmt(a.publishedAt)}</span>
          </span>
        </div>
        <p class="ui:text-muted-foreground text-sm whitespace-pre-wrap">{a.body}</p>
      </li>
    {/each}
  </ul>
{/if}
