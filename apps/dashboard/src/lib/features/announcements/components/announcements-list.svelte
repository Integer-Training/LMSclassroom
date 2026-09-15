<script lang="ts">
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
  import ArchiveIcon from '@lucide/svelte/icons/archive';
  import ArchiveRestoreIcon from '@lucide/svelte/icons/archive-restore';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import type { AnnouncementItem, AnnouncementAudience } from '$features/announcements/api/announcements.svelte';

  // A plain broadcast list (title, body, audience, date). Read-only for recipients (learner home, tutor
  // caseload); with `manage` the admin gets Archive / Delete controls per row.

  interface Props {
    items: AnnouncementItem[];
    showScope?: boolean;
    manage?: boolean;
    busyId?: string | null;
    emptyText?: string;
    onArchive?: (id: string, archived: boolean) => void;
    onDelete?: (id: string) => void;
  }
  let {
    items,
    showScope = true,
    manage = false,
    busyId = null,
    emptyText = 'No announcements yet.',
    onArchive,
    onDelete
  }: Props = $props();

  const AUDIENCE_LABEL: Record<AnnouncementAudience, string> = {
    all_learners: 'All learners',
    all_tutors: 'All tutors',
    course: 'Course',
    learner: 'Learner',
    tutor: "Tutor's learners"
  };

  function audienceText(a: AnnouncementItem): string {
    const base = AUDIENCE_LABEL[a.audienceType] ?? 'Everyone';
    if (a.targetLabel && (a.audienceType === 'course' || a.audienceType === 'learner' || a.audienceType === 'tutor')) {
      return `${base}: ${a.targetLabel}`;
    }
    return base;
  }

  function fmt(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
</script>

{#if items.length === 0}
  <p class="ui:text-muted-foreground text-sm">{emptyText}</p>
{:else}
  <ul class="flex flex-col gap-3">
    {#each items as a (a.id)}
      <li class="ui:border-border rounded-lg border p-3" class:opacity-60={a.archived}>
        <div class="mb-1 flex items-center justify-between gap-2">
          <span class="flex items-center gap-2 text-sm font-semibold">
            <MegaphoneIcon size={14} class="ui:text-muted-foreground shrink-0" />
            {a.title}
          </span>
          <span class="flex shrink-0 items-center gap-2">
            {#if a.archived}
              <Badge variant="outline">Archived</Badge>
            {/if}
            {#if showScope}
              <Badge variant={a.audienceType === 'all_learners' ? 'secondary' : 'outline'}>{audienceText(a)}</Badge>
            {/if}
            <span class="ui:text-muted-foreground text-xs">{fmt(a.publishedAt)}</span>
          </span>
        </div>
        <p class="ui:text-muted-foreground text-sm whitespace-pre-wrap">{a.body}</p>

        {#if manage}
          <div class="mt-2 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={busyId === a.id} onclick={() => onArchive?.(a.id, !a.archived)}>
              {#if a.archived}
                <ArchiveRestoreIcon size={14} class="mr-1" /> Unarchive
              {:else}
                <ArchiveIcon size={14} class="mr-1" /> Archive
              {/if}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="ui:text-destructive"
              disabled={busyId === a.id}
              onclick={() => onDelete?.(a.id)}
            >
              <Trash2Icon size={14} class="mr-1" /> Delete
            </Button>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
