<script lang="ts">
  import * as Table from '@cio/ui/base/table';
  import { Badge } from '@cio/ui/base/badge';
  import CircleIcon from '@lucide/svelte/icons/circle';
  import type { OnlineNow } from '$features/admin-dashboard/api/admin-dashboard.svelte';

  interface Props {
    online: OnlineNow | null;
  }

  let { online }: Props = $props();

  const roleChips = $derived(
    online
      ? [
          { label: 'Learners', value: online.byRole.learners },
          { label: 'Tutors', value: online.byRole.tutors },
          { label: 'Managers', value: online.byRole.managers },
          { label: 'Admins', value: online.byRole.admins }
        ]
      : []
  );

  function relativeTime(iso: string): string {
    const then = new Date(iso).getTime();
    if (isNaN(then)) return iso;
    const diff = Math.max(0, Date.now() - then);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    const days = Math.floor(hrs / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
</script>

<div class="bg-card rounded-xl border p-4 md:p-5">
  <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
    <div class="flex items-center gap-2">
      <span class="relative flex h-2.5 w-2.5">
        <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
        <span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
      </span>
      <h3 class="text-base font-semibold tracking-tight">Online Now</h3>
      <span class="text-2xl font-semibold tabular-nums">{online?.count ?? 0}</span>
    </div>
    <div class="flex flex-wrap gap-1">
      {#each roleChips as chip (chip.label)}
        <Badge variant="secondary" class="tabular-nums">{chip.value} {chip.label}</Badge>
      {/each}
    </div>
  </div>

  {#if !online || online.users.length === 0}
    <div class="text-muted-foreground flex flex-col items-center justify-center gap-2 py-8 text-sm">
      <CircleIcon class="size-5 opacity-40" />
      No one is active right now.
    </div>
  {:else}
    <div class="overflow-x-auto rounded-md border">
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Name</Table.Head>
            <Table.Head>Email</Table.Head>
            <Table.Head>Role</Table.Head>
            <Table.Head class="text-right">Last active</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each online.users as user (user.userId)}
            <Table.Row>
              <Table.Cell class="font-medium">{user.name || 'User'}</Table.Cell>
              <Table.Cell class="text-muted-foreground">{user.email ?? ''}</Table.Cell>
              <Table.Cell><Badge variant="outline" class="capitalize">{user.role}</Badge></Table.Cell>
              <Table.Cell class="text-muted-foreground text-right whitespace-nowrap">
                {relativeTime(user.lastActive)}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
  {/if}
</div>
