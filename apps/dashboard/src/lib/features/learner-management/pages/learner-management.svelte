<script lang="ts">
  import { onMount } from 'svelte';
  import * as Page from '@cio/ui/base/page';
  import * as Table from '@cio/ui/base/table';
  import * as Select from '@cio/ui/base/select';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { Badge } from '@cio/ui/base/badge';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import SearchIcon from '@lucide/svelte/icons/search';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import UsersIcon from '@lucide/svelte/icons/users';
  import KeyIcon from '@lucide/svelte/icons/key-round';
  import LogInIcon from '@lucide/svelte/icons/log-in';
  import { loginAsMember } from '$lib/utils/functions/impersonation';
  import { currentOrg } from '$lib/utils/store/org';
  import { downloadCsv } from '$features/admin-dashboard/utils/export-csv';
  import {
    learnerManagementApi,
    type LearnerMgmtRow
  } from '$features/learner-management/api/learner-management.svelte';
  import KpiCard from '$features/analytics/components/kpi-card.svelte';
  import CreateLearnerDialog from '$features/learner-management/components/create-learner-dialog.svelte';
  import ResetPasswordDialog from '$features/learner-management/components/reset-password-dialog.svelte';
  import { SvelteSet } from 'svelte/reactivity';

  // Admin Learner-management. KPI tiles + a filterable/searchable/paginated roster with per-learner
  // "Send login" (regenerate + reveal a temp password) and suspend/reactivate. Admin-only (API-enforced).

  type ActivityFilter = 'all' | 'active' | 'inactive' | 'created' | 'suspended';

  const ALL = 'all';

  let showCreate = $state(false);
  let showReveal = $state(false);

  let activity = $state<ActivityFilter>('all');
  let courseFilter = $state(ALL);
  let search = $state('');
  let pageSize = $state(25);
  let pageNum = $state(1);

  const expanded = new SvelteSet<number>();

  onMount(() => {
    learnerManagementApi.load();
    learnerManagementApi.loadOptions();
  });

  const kpis = $derived(learnerManagementApi.data?.kpis ?? null);
  const rows = $derived<LearnerMgmtRow[]>(learnerManagementApi.data?.rows ?? []);
  const loading = $derived(learnerManagementApi.isLoading && !learnerManagementApi.data);

  const ACTIVITY_OPTIONS: { value: ActivityFilter; label: string }[] = [
    { value: 'all', label: 'All activity' },
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'created', label: 'Created (never logged in)' },
    { value: 'suspended', label: 'Suspended' }
  ];
  const activityLabel = $derived(ACTIVITY_OPTIONS.find((o) => o.value === activity)?.label ?? 'All activity');

  const courseTitles = $derived.by(() => {
    const seen: Record<string, true> = {};
    for (const r of rows) for (const c of r.courses) if (c.title) seen[c.title] = true;
    return Object.keys(seen).sort((a, b) => a.localeCompare(b));
  });
  const courseFilterLabel = $derived(courseFilter === ALL ? 'All courses' : courseFilter);

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (activity !== 'all' && r.activity !== activity) return false;
      if (courseFilter !== ALL && !r.courses.some((c) => c.title === courseFilter)) return false;
      if (q) {
        const hay = `${r.name ?? ''} ${r.email ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  const totalPages = $derived(Math.max(1, Math.ceil(filtered.length / pageSize)));
  // Keep the current page in range when filters shrink the result set.
  $effect(() => {
    if (pageNum > totalPages) pageNum = totalPages;
  });
  const paged = $derived(filtered.slice((pageNum - 1) * pageSize, (pageNum - 1) * pageSize + pageSize));
  const rangeStart = $derived(filtered.length === 0 ? 0 : (pageNum - 1) * pageSize + 1);
  const rangeEnd = $derived(Math.min(pageNum * pageSize, filtered.length));

  function resetFilters() {
    activity = 'all';
    courseFilter = ALL;
    search = '';
    pageNum = 1;
  }

  function toggleExpand(memberId: number) {
    if (expanded.has(memberId)) expanded.delete(memberId);
    else expanded.add(memberId);
  }

  function openCreate() {
    learnerManagementApi.clearRevealed();
    showCreate = true;
  }

  async function sendLogin(memberId: number) {
    const res = await learnerManagementApi.sendLogin(memberId);
    if (res) showReveal = true;
  }

  function toggleStatus(row: LearnerMgmtRow) {
    learnerManagementApi.setStatus(row.memberId, row.status === 'DEACTIVATED' ? 'ACTIVE' : 'DEACTIVATED');
  }

  function formatTime(seconds: number): string {
    if (!seconds || seconds < 60) return `${Math.max(0, Math.round(seconds || 0))}s`;
    const mins = Math.floor(seconds / 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function formatDate(iso: string | null): string {
    if (!iso) return 'Never';
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? 'Never'
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  const STATUS_META: Record<
    LearnerMgmtRow['activity'],
    { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; class: string }
  > = {
    active: { label: 'Active', variant: 'secondary', class: 'text-emerald-600 dark:text-emerald-400' },
    inactive: { label: 'Inactive', variant: 'secondary', class: 'text-amber-600 dark:text-amber-400' },
    created: { label: 'Created', variant: 'secondary', class: 'ui:text-muted-foreground' },
    suspended: { label: 'Suspended', variant: 'destructive', class: '' }
  };

  function exportCsv() {
    const headers = ['Name', 'Email', 'Tutor', 'Course count', 'Courses', 'Time spent', 'Last login', 'Status'];
    const data = filtered.map((r) => [
      r.name ?? '',
      r.email ?? '',
      r.tutorName ?? 'Unassigned',
      r.courseCount,
      r.courses.map((c) => c.title).join('; '),
      formatTime(r.timeSpentSeconds),
      r.lastLogin ? formatDate(r.lastLogin) : 'Never',
      STATUS_META[r.activity].label
    ]);
    downloadCsv(`learners-${new Date().toISOString().slice(0, 10)}`, headers, data);
  }

  const PAGE_SIZES = [10, 25, 50, 100];
</script>

<svelte:head><title>Learner Management</title></svelte:head>

<Page.Root class="w-full">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>Learner Management</Page.Title>
      <Page.Subtitle>Manage all learners · {$currentOrg.name}</Page.Subtitle>
    </Page.HeaderContent>
    <Page.Action>
      <Button onclick={openCreate}>
        <PlusIcon class="size-4" /> New Learner
      </Button>
    </Page.Action>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      <div class="space-y-6">
        <!-- KPI tiles -->
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard title="Total" value={kpis?.total ?? 0} icon={UsersIcon} accent="primary" {loading} />
          <KpiCard title="Active" value={kpis?.active ?? 0} accent="success" {loading} />
          <KpiCard
            title="Inactive"
            value={kpis?.inactive ?? 0}
            description="No login in 30+ days"
            accent="warning"
            {loading}
          />
          <KpiCard
            title="Created"
            value={kpis?.created ?? 0}
            description="Never logged in"
            accent="primary"
            {loading}
          />
          <KpiCard title="Suspended" value={kpis?.suspended ?? 0} accent="danger" {loading} />
        </div>

        <!-- Learner Details -->
        <div class="bg-card rounded-xl border p-4">
          <div class="mb-4 flex flex-col gap-3">
            <div class="flex items-center justify-between gap-2">
              <h2 class="text-lg font-semibold tracking-tight">Learner Details</h2>
              <Button variant="outline" size="sm" onclick={exportCsv} disabled={filtered.length === 0}>
                <DownloadIcon class="size-4" /> Export CSV
              </Button>
            </div>

            <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div class="space-y-1">
                <span class="ui:text-muted-foreground text-xs font-medium">Activity</span>
                <Select.Root type="single" bind:value={activity}>
                  <Select.Trigger class="sm:w-52">{activityLabel}</Select.Trigger>
                  <Select.Content>
                    {#each ACTIVITY_OPTIONS as opt (opt.value)}
                      <Select.Item value={opt.value}>{opt.label}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
              </div>

              <div class="space-y-1">
                <span class="ui:text-muted-foreground text-xs font-medium">Course</span>
                <Select.Root type="single" bind:value={courseFilter}>
                  <Select.Trigger class="sm:w-52">{courseFilterLabel}</Select.Trigger>
                  <Select.Content>
                    <Select.Item value={ALL}>All courses</Select.Item>
                    {#each courseTitles as title (title)}
                      <Select.Item value={title}>{title}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
              </div>

              <div class="space-y-1 sm:flex-1">
                <span class="ui:text-muted-foreground text-xs font-medium">Search</span>
                <div class="relative">
                  <SearchIcon
                    class="ui:text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                  />
                  <Input bind:value={search} placeholder="Name or email…" class="pl-8" autocomplete="off" />
                </div>
              </div>

              <Button variant="ghost" size="sm" onclick={resetFilters}>Reset</Button>
            </div>
          </div>

          <div class="overflow-x-auto rounded-md border">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head class="w-8"></Table.Head>
                  <Table.Head>Name</Table.Head>
                  <Table.Head>Email</Table.Head>
                  <Table.Head>Tutor</Table.Head>
                  <Table.Head class="text-right">Courses</Table.Head>
                  <Table.Head class="text-right">Time spent</Table.Head>
                  <Table.Head>Last login</Table.Head>
                  <Table.Head>Status</Table.Head>
                  <Table.Head class="text-right">Actions</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#if loading}
                  <Table.Row>
                    <Table.Cell colspan={9} class="ui:text-muted-foreground py-10 text-center text-sm"
                      >Loading…</Table.Cell
                    >
                  </Table.Row>
                {:else if filtered.length === 0}
                  <Table.Row>
                    <Table.Cell colspan={9} class="py-10 text-center">
                      <UsersIcon class="ui:text-muted-foreground mx-auto mb-2 size-6" />
                      <p class="text-sm font-medium">No learners match your filters</p>
                      <p class="ui:text-muted-foreground mt-1 text-xs">
                        {rows.length === 0
                          ? 'No learners yet — create one to get started.'
                          : 'Try clearing the filters.'}
                      </p>
                    </Table.Cell>
                  </Table.Row>
                {:else}
                  {#each paged as row (row.memberId)}
                    <Table.Row>
                      <Table.Cell>
                        {#if row.courseCount > 0}
                          <button
                            type="button"
                            class="ui:text-muted-foreground ui:hover:text-foreground"
                            aria-label={expanded.has(row.memberId) ? 'Collapse courses' : 'Expand courses'}
                            onclick={() => toggleExpand(row.memberId)}
                          >
                            {#if expanded.has(row.memberId)}
                              <ChevronDownIcon class="size-4" />
                            {:else}
                              <ChevronRightIcon class="size-4" />
                            {/if}
                          </button>
                        {/if}
                      </Table.Cell>
                      <Table.Cell class="font-medium whitespace-nowrap">{row.name || 'Learner'}</Table.Cell>
                      <Table.Cell class="ui:text-muted-foreground">{row.email ?? ''}</Table.Cell>
                      <Table.Cell class="whitespace-nowrap">
                        {#if row.tutorName}
                          {row.tutorName}
                        {:else}
                          <span class="ui:text-muted-foreground">Unassigned</span>
                        {/if}
                      </Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{row.courseCount}</Table.Cell>
                      <Table.Cell class="text-right whitespace-nowrap tabular-nums"
                        >{formatTime(row.timeSpentSeconds)}</Table.Cell
                      >
                      <Table.Cell class="whitespace-nowrap">{formatDate(row.lastLogin)}</Table.Cell>
                      <Table.Cell>
                        <Badge variant={STATUS_META[row.activity].variant} class={STATUS_META[row.activity].class}>
                          {STATUS_META[row.activity].label}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell class="text-right whitespace-nowrap">
                        <div class="flex items-center justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={learnerManagementApi.busyMemberId === row.memberId}
                            onclick={() => loginAsMember(row.memberId)}
                          >
                            <LogInIcon class="size-4" /> Login As
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            loading={learnerManagementApi.busyMemberId === row.memberId}
                            disabled={learnerManagementApi.busyMemberId === row.memberId}
                            onclick={() => sendLogin(row.memberId)}
                          >
                            <KeyIcon class="size-4" /> Send Login
                          </Button>
                          <Button
                            variant={row.status === 'DEACTIVATED' ? 'default' : 'ghost'}
                            size="sm"
                            disabled={learnerManagementApi.busyMemberId === row.memberId}
                            onclick={() => toggleStatus(row)}
                          >
                            {row.status === 'DEACTIVATED' ? 'Reactivate' : 'Suspend'}
                          </Button>
                        </div>
                      </Table.Cell>
                    </Table.Row>
                    {#if expanded.has(row.memberId)}
                      <Table.Row class="ui:bg-muted/30">
                        <Table.Cell></Table.Cell>
                        <Table.Cell colspan={8}>
                          <div class="flex flex-wrap gap-1.5 py-1">
                            {#each row.courses as c (c.courseId)}
                              <Badge variant="outline">{c.title}</Badge>
                            {/each}
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    {/if}
                  {/each}
                {/if}
              </Table.Body>
            </Table.Root>
          </div>

          <!-- Pagination -->
          {#if filtered.length > 0}
            <div class="mt-3 flex flex-col items-center justify-between gap-3 sm:flex-row">
              <div class="ui:text-muted-foreground flex items-center gap-2 text-xs">
                <span>Rows per page</span>
                <Select.Root
                  type="single"
                  value={String(pageSize)}
                  onValueChange={(v) => {
                    pageSize = Number(v);
                    pageNum = 1;
                  }}
                >
                  <Select.Trigger class="h-8 w-[72px]">{pageSize}</Select.Trigger>
                  <Select.Content>
                    {#each PAGE_SIZES as size (size)}
                      <Select.Item value={String(size)}>{size}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
              </div>

              <div class="flex items-center gap-3">
                <span class="ui:text-muted-foreground text-xs tabular-nums">
                  {rangeStart}–{rangeEnd} of {filtered.length}
                </span>
                <div class="flex items-center gap-1">
                  <Button variant="outline" size="sm" disabled={pageNum <= 1} onclick={() => (pageNum -= 1)}
                    >Prev</Button
                  >
                  <Button variant="outline" size="sm" disabled={pageNum >= totalPages} onclick={() => (pageNum += 1)}
                    >Next</Button
                  >
                </div>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/snippet}
  </Page.Body>
</Page.Root>

<CreateLearnerDialog bind:open={showCreate} />
<ResetPasswordDialog bind:open={showReveal} />
