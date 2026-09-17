<script lang="ts">
  import { onMount } from 'svelte';
  import * as Page from '@cio/ui/base/page';
  import * as Table from '@cio/ui/base/table';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { Badge } from '@cio/ui/base/badge';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import SearchIcon from '@lucide/svelte/icons/search';
  import KeyIcon from '@lucide/svelte/icons/key-round';
  import ShieldIcon from '@lucide/svelte/icons/shield';
  import UsersIcon from '@lucide/svelte/icons/users';
  import { currentOrg } from '$lib/utils/store/org';
  import { adminManagementApi, type AdminMgmtRow } from '$features/admin-management/api/admin-management.svelte';
  import ResetPasswordDialog from '$features/admin-management/components/reset-password-dialog.svelte';
  import CreateAdminDialog from '$features/admin-management/components/create-admin-dialog.svelte';

  // Admin Admin-management. Roster of org admins with a "Reset Password" action. The super admin (earliest
  // admin) and the caller themselves cannot be reset here (server-enforced too). Admin-only (API-enforced).
  // Only the super admin sees "New Admin" (creating an admin is super-admin-only, also server-enforced).

  let showReveal = $state(false);
  let showCreate = $state(false);
  let search = $state('');

  onMount(() => {
    adminManagementApi.load();
  });

  const rows = $derived<AdminMgmtRow[]>(adminManagementApi.data?.rows ?? []);
  const count = $derived(adminManagementApi.data?.count ?? 0);
  const canCreate = $derived(adminManagementApi.data?.canCreateAdmins ?? false);
  const loading = $derived(adminManagementApi.isLoading && !adminManagementApi.data);

  function openCreate() {
    adminManagementApi.clearRevealed();
    showCreate = true;
  }

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.name ?? ''} ${r.email ?? ''}`.toLowerCase().includes(q));
  });

  // Split a display name into first / last on the first space; a single token goes entirely into first.
  function splitName(name: string | null): { first: string; last: string } {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return { first: 'Admin', last: '' };
    const idx = trimmed.indexOf(' ');
    if (idx === -1) return { first: trimmed, last: '' };
    return { first: trimmed.slice(0, idx), last: trimmed.slice(idx + 1) };
  }

  async function resetPassword(memberId: number) {
    const res = await adminManagementApi.resetPassword(memberId);
    if (res) showReveal = true;
  }
</script>

<svelte:head><title>Admin Management</title></svelte:head>

<Page.Root class="w-full">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>Admin Management</Page.Title>
      <Page.Subtitle>Reset admin passwords · {$currentOrg.name}</Page.Subtitle>
    </Page.HeaderContent>
    {#if canCreate}
      <Page.Action>
        <Button onclick={openCreate}>
          <PlusIcon class="size-4" /> New Admin
        </Button>
      </Page.Action>
    {/if}
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      <div class="bg-card rounded-xl border p-4">
        <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-center gap-2">
            <h2 class="text-lg font-semibold tracking-tight">Admin Accounts</h2>
            <Badge variant="secondary" class="tabular-nums">{count}</Badge>
          </div>
          <div class="flex items-center gap-2">
            <div class="relative flex-1 sm:w-64 sm:flex-none">
              <SearchIcon
                class="ui:text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              />
              <Input bind:value={search} placeholder="Name or email…" class="ui:pl-9" autocomplete="off" />
            </div>
          </div>
        </div>

        <div class="overflow-x-auto rounded-md border">
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>First name</Table.Head>
                <Table.Head>Last name</Table.Head>
                <Table.Head>Email</Table.Head>
                <Table.Head>Role</Table.Head>
                <Table.Head>Status</Table.Head>
                <Table.Head class="text-right">Actions</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#if loading}
                <Table.Row>
                  <Table.Cell colspan={6} class="ui:text-muted-foreground py-10 text-center text-sm"
                    >Loading…</Table.Cell
                  >
                </Table.Row>
              {:else if filtered.length === 0}
                <Table.Row>
                  <Table.Cell colspan={6} class="py-10 text-center">
                    <UsersIcon class="ui:text-muted-foreground mx-auto mb-2 size-6" />
                    <p class="text-sm font-medium">No admins found</p>
                    <p class="ui:text-muted-foreground mt-1 text-xs">
                      {rows.length === 0 ? 'No admins in this organization.' : 'Try a different search.'}
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
                      {#if row.isSuperAdmin}
                        <Badge class="gap-1">
                          <ShieldIcon class="size-3" /> Super Admin
                        </Badge>
                      {:else}
                        <Badge variant="outline">Admin</Badge>
                      {/if}
                    </Table.Cell>
                    <Table.Cell>
                      {#if row.status === 'DEACTIVATED'}
                        <Badge variant="destructive">Suspended</Badge>
                      {:else}
                        <Badge variant="secondary" class="text-emerald-600 dark:text-emerald-400">Active</Badge>
                      {/if}
                    </Table.Cell>
                    <Table.Cell class="text-right whitespace-nowrap">
                      {#if row.isSuperAdmin}
                        <span class="ui:text-muted-foreground text-xs">Protected</span>
                      {:else if row.isSelf}
                        <span class="ui:text-muted-foreground text-xs">Use Change Password</span>
                      {:else}
                        <Button
                          variant="outline"
                          size="sm"
                          loading={adminManagementApi.busyMemberId === row.memberId}
                          disabled={adminManagementApi.busyMemberId === row.memberId}
                          onclick={() => resetPassword(row.memberId)}
                        >
                          <KeyIcon class="size-4" /> Reset Password
                        </Button>
                      {/if}
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

<ResetPasswordDialog bind:open={showReveal} />
<CreateAdminDialog bind:open={showCreate} />
