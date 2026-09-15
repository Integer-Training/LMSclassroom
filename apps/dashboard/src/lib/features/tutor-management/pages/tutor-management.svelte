<script lang="ts">
  import { onMount } from 'svelte';
  import * as Page from '@cio/ui/base/page';
  import * as Table from '@cio/ui/base/table';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { Badge } from '@cio/ui/base/badge';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import SearchIcon from '@lucide/svelte/icons/search';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import KeyIcon from '@lucide/svelte/icons/key-round';
  import UsersIcon from '@lucide/svelte/icons/users';
  import { currentOrg } from '$lib/utils/store/org';
  import { downloadCsv } from '$features/admin-dashboard/utils/export-csv';
  import { tutorManagementApi, type TutorMgmtRow } from '$features/tutor-management/api/tutor-management.svelte';
  import CreateTutorDialog from '$features/tutor-management/components/create-tutor-dialog.svelte';
  import ResetPasswordDialog from '$features/tutor-management/components/reset-password-dialog.svelte';

  // Admin Tutor-management. Roster of tutors with caseloads (course titles) + learner counts, tutor
  // creation, "Send login" (regenerate + reveal), and suspend/reactivate. Admin-only (API-enforced).

  let showCreate = $state(false);
  let showReveal = $state(false);
  let search = $state('');

  onMount(() => {
    tutorManagementApi.load();
  });

  const rows = $derived<TutorMgmtRow[]>(tutorManagementApi.data?.rows ?? []);
  const count = $derived(tutorManagementApi.data?.count ?? 0);
  const loading = $derived(tutorManagementApi.isLoading && !tutorManagementApi.data);

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.name ?? ''} ${r.email ?? ''}`.toLowerCase().includes(q));
  });

  // Split a display name into first / last on the first space; a single token goes entirely into first.
  function splitName(name: string | null): { first: string; last: string } {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return { first: 'Tutor', last: '' };
    const idx = trimmed.indexOf(' ');
    if (idx === -1) return { first: trimmed, last: '' };
    return { first: trimmed.slice(0, idx), last: trimmed.slice(idx + 1) };
  }

  function openCreate() {
    tutorManagementApi.clearRevealed();
    showCreate = true;
  }

  async function sendLogin(memberId: number) {
    const res = await tutorManagementApi.sendLogin(memberId);
    if (res) showReveal = true;
  }

  function toggleStatus(row: TutorMgmtRow) {
    tutorManagementApi.setStatus(row.memberId, row.status === 'DEACTIVATED' ? 'ACTIVE' : 'DEACTIVATED');
  }

  function exportCsv() {
    const headers = ['First name', 'Last name', 'Email', 'Caseloads', 'Learners', 'Status'];
    const data = filtered.map((r) => {
      const { first, last } = splitName(r.name);
      return [
        first,
        last,
        r.email ?? '',
        r.courses.map((c) => c.title).join('; '),
        r.learnerCount,
        r.status === 'DEACTIVATED' ? 'Suspended' : 'Active'
      ];
    });
    downloadCsv(`tutors-${new Date().toISOString().slice(0, 10)}`, headers, data);
  }
</script>

<svelte:head><title>Tutor Management</title></svelte:head>

<Page.Root class="w-full">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>Tutor Management</Page.Title>
      <Page.Subtitle>Manage all tutors · {$currentOrg.name}</Page.Subtitle>
    </Page.HeaderContent>
    <Page.Action>
      <Button onclick={openCreate}>
        <PlusIcon class="size-4" /> New Tutor
      </Button>
    </Page.Action>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      <div class="bg-card rounded-xl border p-4">
        <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-center gap-2">
            <h2 class="text-lg font-semibold tracking-tight">Tutor Accounts</h2>
            <Badge variant="secondary" class="tabular-nums">{count}</Badge>
          </div>
          <div class="flex items-center gap-2">
            <div class="relative flex-1 sm:w-64 sm:flex-none">
              <SearchIcon
                class="ui:text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              />
              <Input bind:value={search} placeholder="Name or email…" class="pl-8" autocomplete="off" />
            </div>
            <Button variant="outline" size="sm" onclick={exportCsv} disabled={filtered.length === 0}>
              <DownloadIcon class="size-4" /> Export CSV
            </Button>
          </div>
        </div>

        <div class="overflow-x-auto rounded-md border">
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>First name</Table.Head>
                <Table.Head>Last name</Table.Head>
                <Table.Head>Email</Table.Head>
                <Table.Head>Caseloads</Table.Head>
                <Table.Head class="text-right">Learners</Table.Head>
                <Table.Head>Status</Table.Head>
                <Table.Head class="text-right">Actions</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#if loading}
                <Table.Row>
                  <Table.Cell colspan={7} class="ui:text-muted-foreground py-10 text-center text-sm"
                    >Loading…</Table.Cell
                  >
                </Table.Row>
              {:else if filtered.length === 0}
                <Table.Row>
                  <Table.Cell colspan={7} class="py-10 text-center">
                    <UsersIcon class="ui:text-muted-foreground mx-auto mb-2 size-6" />
                    <p class="text-sm font-medium">No tutors found</p>
                    <p class="ui:text-muted-foreground mt-1 text-xs">
                      {rows.length === 0 ? 'No tutors yet — create one to get started.' : 'Try a different search.'}
                    </p>
                  </Table.Cell>
                </Table.Row>
              {:else}
                {#each filtered as row (row.memberId)}
                  {@const parts = splitName(row.name)}
                  <Table.Row>
                    <Table.Cell class="font-medium whitespace-nowrap">{parts.first}</Table.Cell>
                    <Table.Cell class="whitespace-nowrap">{parts.last}</Table.Cell>
                    <Table.Cell class="ui:text-muted-foreground">{row.email ?? ''}</Table.Cell>
                    <Table.Cell>
                      {#if row.courses.length === 0}
                        <span class="ui:text-muted-foreground">—</span>
                      {:else}
                        <div class="flex flex-wrap gap-1.5">
                          {#each row.courses as c (c.courseId)}
                            <Badge variant="outline">{c.title}</Badge>
                          {/each}
                        </div>
                      {/if}
                    </Table.Cell>
                    <Table.Cell class="text-right tabular-nums">{row.learnerCount}</Table.Cell>
                    <Table.Cell>
                      {#if row.status === 'DEACTIVATED'}
                        <Badge variant="destructive">Suspended</Badge>
                      {:else}
                        <Badge variant="secondary" class="text-emerald-600 dark:text-emerald-400">Active</Badge>
                      {/if}
                    </Table.Cell>
                    <Table.Cell class="text-right whitespace-nowrap">
                      <div class="flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          loading={tutorManagementApi.busyMemberId === row.memberId}
                          disabled={tutorManagementApi.busyMemberId === row.memberId}
                          onclick={() => sendLogin(row.memberId)}
                        >
                          <KeyIcon class="size-4" /> Send Login
                        </Button>
                        <Button
                          variant={row.status === 'DEACTIVATED' ? 'default' : 'ghost'}
                          size="sm"
                          disabled={tutorManagementApi.busyMemberId === row.memberId}
                          onclick={() => toggleStatus(row)}
                        >
                          {row.status === 'DEACTIVATED' ? 'Reactivate' : 'Suspend'}
                        </Button>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                {/each}
              {/if}
            </Table.Body>
          </Table.Root>
        </div>
      </div>
    {/snippet}
  </Page.Body>
</Page.Root>

<CreateTutorDialog bind:open={showCreate} />
<ResetPasswordDialog bind:open={showReveal} />
