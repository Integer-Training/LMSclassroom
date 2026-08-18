<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import * as Table from '@cio/ui/base/table';
  import * as Dialog from '@cio/ui/base/dialog';
  import * as Select from '@cio/ui/base/select';
  import * as DropdownMenu from '@cio/ui/base/dropdown-menu';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { Badge } from '@cio/ui/base/badge';
  import { Search } from '@cio/ui/custom/search';
  import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
  import { ROLE, roleIdToName } from '@cio/utils/constants';
  import { usersApi, type OrgUser, type LearnerProfile, EMPTY_LEARNER_PROFILE } from '$features/users/api/users.svelte';

  // Admin-only user management (Phase 1 Step 7). The org/[slug] layout enforces requireAdmin
  // server-side, and every API endpoint is requireAdmin — this UI is a courtesy on top.

  const ROLE_OPTIONS = [
    { value: String(ROLE.ADMIN), label: 'Admin' },
    { value: String(ROLE.MANAGER), label: 'Manager' },
    { value: String(ROLE.TUTOR), label: 'Tutor' },
    { value: String(ROLE.LEARNER), label: 'Learner' }
  ];
  function roleLabel(roleId: number): string {
    const name = roleIdToName(roleId);
    return name ? name.charAt(0) + name.slice(1).toLowerCase() : 'Unknown';
  }

  let searchValue = $state('');
  let debounce: ReturnType<typeof setTimeout>;
  let firstRun = true;

  // Create-user modal
  let createOpen = $state(false);
  let cName = $state('');
  let cEmail = $state('');
  let cRole = $state(String(ROLE.LEARNER));

  // Change-role modal
  let roleOpen = $state(false);
  let roleTarget = $state<OrgUser | null>(null);
  let roleValue = $state(String(ROLE.LEARNER));

  // Deactivate/reactivate confirm modal
  let statusOpen = $state(false);
  let statusTarget = $state<OrgUser | null>(null);

  // Enrolment PII (Admin-only) modal
  let profileOpen = $state(false);
  let profileTarget = $state<OrgUser | null>(null);
  let profileForm = $state<LearnerProfile>({ ...EMPTY_LEARNER_PROFILE });
  let profileLoading = $state(false);
  const PII_FIELDS: Array<{ key: keyof LearnerProfile; label: string; type: 'date' | 'text' | 'textarea' }> = [
    { key: 'dateOfBirth', label: 'Date of birth', type: 'date' },
    { key: 'niNumber', label: 'NI number', type: 'text' },
    { key: 'gender', label: 'Gender', type: 'text' },
    { key: 'ethnicity', label: 'Ethnicity', type: 'text' },
    { key: 'disability', label: 'Disability', type: 'text' },
    { key: 'address', label: 'Address', type: 'text' },
    { key: 'aebRegion', label: 'AEB region', type: 'text' },
    { key: 'collegeRef', label: 'College ref', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'textarea' }
  ];

  onMount(() => usersApi.list());

  $effect(() => {
    const v = searchValue;
    if (firstRun) {
      firstRun = false;
      return;
    }
    clearTimeout(debounce);
    debounce = setTimeout(() => usersApi.list({ search: v, page: 1 }), 300);
  });

  async function submitCreate() {
    const ok = await usersApi.createUser({ name: cName.trim(), email: cEmail.trim(), roleId: Number(cRole) });
    if (ok) {
      createOpen = false;
      cName = '';
      cEmail = '';
      cRole = String(ROLE.LEARNER);
    }
  }

  function openRole(u: OrgUser) {
    roleTarget = u;
    roleValue = String(u.roleId);
    roleOpen = true;
  }
  async function submitRole() {
    if (!roleTarget) return;
    const ok = await usersApi.changeRole(roleTarget.memberId, Number(roleValue));
    if (ok) roleOpen = false;
  }

  function openStatus(u: OrgUser) {
    statusTarget = u;
    statusOpen = true;
  }

  async function openProfile(u: OrgUser) {
    profileTarget = u;
    profileForm = { ...EMPTY_LEARNER_PROFILE };
    profileOpen = true;
    profileLoading = true;
    const loaded = await usersApi.getProfile(u.memberId);
    if (loaded) profileForm = { ...EMPTY_LEARNER_PROFILE, ...loaded };
    profileLoading = false;
  }
  async function submitProfile() {
    if (!profileTarget) return;
    const ok = await usersApi.saveProfile(profileTarget.memberId, profileForm);
    if (ok) profileOpen = false;
  }
  async function submitStatus() {
    if (!statusTarget) return;
    const next = statusTarget.status === 'DEACTIVATED' ? 'ACTIVE' : 'DEACTIVATED';
    const ok = await usersApi.setStatus(statusTarget.memberId, next);
    if (ok) statusOpen = false;
  }

  // Lite onboarding (Phase 5 Step 5) — create learner + enrol + issue credential in one flow.
  let onboardOpen = $state(false);
  let oName = $state('');
  let oEmail = $state('');
  let oCourseId = $state('');
  const slug = $derived(page.params.slug ?? '');

  async function openOnboard() {
    usersApi.onboardResult = null;
    oName = '';
    oEmail = '';
    oCourseId = '';
    onboardOpen = true;
    await usersApi.loadOnboardingCourses();
    if (!oCourseId && usersApi.onboardingCourses[0]) oCourseId = usersApi.onboardingCourses[0].courseId;
  }
  async function submitOnboard() {
    if (!oName.trim() || !oEmail.trim() || !oCourseId) return;
    // On success the store sets usersApi.onboardResult → the dialog switches to the success state.
    await usersApi.onboardLearner({ name: oName.trim(), email: oEmail.trim(), courseId: oCourseId });
  }
  function closeOnboard() {
    onboardOpen = false;
    usersApi.onboardResult = null;
  }
  const courseLabel = $derived(
    usersApi.onboardingCourses.find((c) => c.courseId === oCourseId)?.title ?? 'Select a course'
  );
</script>

<div class="mx-auto w-full max-w-5xl p-6">
  <div class="mb-6 flex items-center justify-between gap-3">
    <div>
      <h1 class="text-xl font-semibold">Users</h1>
      <p class="text-muted-foreground text-sm">Create, role, and deactivate accounts. Admin only.</p>
    </div>
    <div class="flex items-center gap-2">
      <Button variant="outline" onclick={openOnboard}>Onboard learner</Button>
      <Button onclick={() => (createOpen = true)}>Create user</Button>
    </div>
  </div>

  <div class="mb-4">
    <Search placeholder="Search name or email" bind:value={searchValue} class="w-full md:max-w-sm" />
  </div>

  <div class="rounded-md border">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>Name</Table.Head>
          <Table.Head>Email</Table.Head>
          <Table.Head>Role</Table.Head>
          <Table.Head>Status</Table.Head>
          <Table.Head class="text-right">Actions</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#if usersApi.users.length === 0}
          <Table.Row>
            <Table.Cell colspan={5} class="text-muted-foreground py-8 text-center text-sm">
              {usersApi.isLoading ? 'Loading…' : 'No users found.'}
            </Table.Cell>
          </Table.Row>
        {:else}
          {#each usersApi.users as u (u.memberId)}
            <Table.Row>
              <Table.Cell class="font-medium">{u.name}</Table.Cell>
              <Table.Cell>{u.email}</Table.Cell>
              <Table.Cell><Badge variant="secondary">{roleLabel(u.roleId)}</Badge></Table.Cell>
              <Table.Cell>
                {#if u.status === 'DEACTIVATED'}
                  <Badge variant="destructive">Deactivated</Badge>
                {:else}
                  <Badge variant="outline">Active</Badge>
                {/if}
              </Table.Cell>
              <Table.Cell class="text-right">
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger
                    class="hover:ui:bg-muted inline-flex items-center justify-center rounded-md p-1.5"
                    aria-label="User actions"
                  >
                    <EllipsisVerticalIcon class="ui:size-4 ui:text-muted-foreground" />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end">
                    <DropdownMenu.Item onclick={() => openProfile(u)}>Edit profile (PII)</DropdownMenu.Item>
                    <DropdownMenu.Item onclick={() => openRole(u)}>Change role</DropdownMenu.Item>
                    {#if u.status === 'DEACTIVATED'}
                      <DropdownMenu.Item onclick={() => openStatus(u)}>Reactivate</DropdownMenu.Item>
                    {:else}
                      <DropdownMenu.Item
                        class="ui:text-destructive focus:ui:text-destructive"
                        onclick={() => openStatus(u)}
                      >
                        Deactivate
                      </DropdownMenu.Item>
                    {/if}
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </Table.Cell>
            </Table.Row>
          {/each}
        {/if}
      </Table.Body>
    </Table.Root>
  </div>

  {#if usersApi.totalPages > 1}
    <div class="mt-4 flex items-center justify-end gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={usersApi.page <= 1 || usersApi.isLoading}
        onclick={() => usersApi.list({ search: searchValue, page: usersApi.page - 1 })}
      >
        Previous
      </Button>
      <span class="text-muted-foreground text-sm">Page {usersApi.page} of {usersApi.totalPages}</span>
      <Button
        variant="outline"
        size="sm"
        disabled={usersApi.page >= usersApi.totalPages || usersApi.isLoading}
        onclick={() => usersApi.list({ search: searchValue, page: usersApi.page + 1 })}
      >
        Next
      </Button>
    </div>
  {/if}
</div>

<!-- Create user -->
<Dialog.Root bind:open={createOpen}>
  <Dialog.Content class="w-full max-w-md">
    <Dialog.Header>
      <Dialog.Title>Create user</Dialog.Title>
      <Dialog.Description>The user receives a set-password email to finish setting up their account.</Dialog.Description
      >
    </Dialog.Header>
    <div class="space-y-3">
      <div class="space-y-1">
        <label for="new-user-name" class="text-sm font-medium">Full name</label>
        <Input id="new-user-name" bind:value={cName} placeholder="Jane Doe" />
      </div>
      <div class="space-y-1">
        <label for="new-user-email" class="text-sm font-medium">Email</label>
        <Input id="new-user-email" type="email" bind:value={cEmail} placeholder="jane@example.com" />
      </div>
      <div class="space-y-1">
        <label for="new-user-role" class="text-sm font-medium">Role</label>
        <Select.Root type="single" bind:value={cRole}>
          <Select.Trigger id="new-user-role" class="ui:w-full">{roleLabel(Number(cRole))}</Select.Trigger>
          <Select.Content>
            {#each ROLE_OPTIONS as opt (opt.value)}
              <Select.Item value={opt.value}>{opt.label}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <Button variant="outline" onclick={() => (createOpen = false)} disabled={usersApi.isLoading}>Cancel</Button>
        <Button onclick={submitCreate} loading={usersApi.isLoading} disabled={!cName.trim() || !cEmail.trim()}>
          Create &amp; invite
        </Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>

<!-- Onboard learner (Phase 5 Step 5): create + enrol + credential in one flow -->
<Dialog.Root bind:open={onboardOpen}>
  <Dialog.Content class="w-full max-w-md">
    {#if usersApi.onboardResult}
      <Dialog.Header>
        <Dialog.Title>Learner onboarded</Dialog.Title>
        <Dialog.Description>
          {usersApi.onboardResult.learnerName} was created and enrolled in
          {usersApi.onboardResult.courseTitle ?? 'the course'}. A set-password invite was emailed — they set their own
          login from the link.
        </Dialog.Description>
      </Dialog.Header>
      <div class="space-y-3">
        <div class="ui:border-border ui:bg-muted/40 rounded-md border p-3 text-sm">
          <p class="font-medium">Next: allocate a tutor</p>
          <p class="ui:text-muted-foreground mt-1 text-xs">
            Assign this learner to a tutor so their coursework can be marked.
          </p>
          <a
            href={`/org/${slug}/allocation`}
            class="ui:text-primary mt-2 inline-block text-sm font-medium hover:underline"
          >
            Go to tutor allocation →
          </a>
        </div>
        <p class="ui:text-muted-foreground text-xs">
          Add enrolment details (date of birth, address, etc.) any time from the Users table — “Edit profile”.
        </p>
        <div class="flex justify-end gap-2 pt-1">
          <Button variant="outline" onclick={openOnboard}>Onboard another</Button>
          <Button onclick={closeOnboard}>Done</Button>
        </div>
      </div>
    {:else}
      <Dialog.Header>
        <Dialog.Title>Onboard learner</Dialog.Title>
        <Dialog.Description>
          Create a learner account, enrol them into a course, and send their set-password invite — in one step.
        </Dialog.Description>
      </Dialog.Header>
      <div class="space-y-3">
        <div class="space-y-1">
          <label for="onboard-name" class="text-sm font-medium">Full name</label>
          <Input id="onboard-name" bind:value={oName} placeholder="Jane Doe" />
        </div>
        <div class="space-y-1">
          <label for="onboard-email" class="text-sm font-medium">Email</label>
          <Input id="onboard-email" type="email" bind:value={oEmail} placeholder="jane@example.com" />
        </div>
        <div class="space-y-1">
          <label for="onboard-course" class="text-sm font-medium">Course</label>
          {#if usersApi.onboardingCourses.length === 0}
            <p class="ui:text-muted-foreground text-xs">No published courses to enrol into.</p>
          {:else}
            <Select.Root type="single" bind:value={oCourseId}>
              <Select.Trigger id="onboard-course" class="ui:w-full">{courseLabel}</Select.Trigger>
              <Select.Content>
                {#each usersApi.onboardingCourses as course (course.courseId)}
                  <Select.Item value={course.courseId}>{course.title ?? 'Untitled course'}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          {/if}
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <Button variant="outline" onclick={() => (onboardOpen = false)} disabled={usersApi.isLoading}>Cancel</Button>
          <Button
            onclick={submitOnboard}
            loading={usersApi.isLoading}
            disabled={!oName.trim() || !oEmail.trim() || !oCourseId}
          >
            Create, enrol &amp; invite
          </Button>
        </div>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<!-- Change role -->
<Dialog.Root bind:open={roleOpen}>
  <Dialog.Content class="w-full max-w-md">
    <Dialog.Header>
      <Dialog.Title>Change role</Dialog.Title>
      <Dialog.Description>{roleTarget?.email ?? ''}</Dialog.Description>
    </Dialog.Header>
    <div class="space-y-3">
      <Select.Root type="single" bind:value={roleValue}>
        <Select.Trigger class="ui:w-full">{roleLabel(Number(roleValue))}</Select.Trigger>
        <Select.Content>
          {#each ROLE_OPTIONS as opt (opt.value)}
            <Select.Item value={opt.value}>{opt.label}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
      <div class="flex justify-end gap-2 pt-2">
        <Button variant="outline" onclick={() => (roleOpen = false)} disabled={usersApi.isLoading}>Cancel</Button>
        <Button onclick={submitRole} loading={usersApi.isLoading}>Save</Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>

<!-- Deactivate / reactivate -->
<Dialog.Root bind:open={statusOpen}>
  <Dialog.Content class="w-full max-w-md">
    <Dialog.Header>
      <Dialog.Title>{statusTarget?.status === 'DEACTIVATED' ? 'Reactivate user' : 'Deactivate user'}</Dialog.Title>
      <Dialog.Description>
        {#if statusTarget?.status === 'DEACTIVATED'}
          Restore access for {statusTarget?.email}. They will be able to sign in again.
        {:else}
          Deactivate {statusTarget?.email}. Their current session ends immediately and they cannot sign in until
          reactivated.
        {/if}
      </Dialog.Description>
    </Dialog.Header>
    <div class="flex justify-end gap-2 pt-2">
      <Button variant="outline" onclick={() => (statusOpen = false)} disabled={usersApi.isLoading}>Cancel</Button>
      <Button
        variant={statusTarget?.status === 'DEACTIVATED' ? 'default' : 'destructive'}
        onclick={submitStatus}
        loading={usersApi.isLoading}
      >
        {statusTarget?.status === 'DEACTIVATED' ? 'Reactivate' : 'Deactivate'}
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>

<!-- Enrolment PII (Admin-only). Loaded on open via the requireAdmin endpoint; never in any non-admin payload. -->
<Dialog.Root bind:open={profileOpen}>
  <Dialog.Content class="max-h-[85vh] w-full max-w-lg overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>Learner profile (PII)</Dialog.Title>
      <Dialog.Description
        >{profileTarget?.email ?? ''} — Admin only. Special-category fields included.</Dialog.Description
      >
    </Dialog.Header>
    <div class="space-y-3">
      {#if profileLoading}
        <p class="text-muted-foreground text-sm">Loading…</p>
      {:else}
        {#each PII_FIELDS as f (f.key)}
          <div class="space-y-1">
            <label for={`pii-${f.key}`} class="text-sm font-medium">{f.label}</label>
            {#if f.type === 'textarea'}
              <textarea
                id={`pii-${f.key}`}
                class="border-input bg-background focus-visible:ring-ring min-h-[72px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:outline-none"
                value={profileForm[f.key] ?? ''}
                oninput={(e) => (profileForm[f.key] = e.currentTarget.value || null)}
              ></textarea>
            {:else}
              <Input
                id={`pii-${f.key}`}
                type={f.type === 'date' ? 'date' : 'text'}
                value={profileForm[f.key] ?? ''}
                oninput={(e) => (profileForm[f.key] = e.currentTarget.value || null)}
              />
            {/if}
          </div>
        {/each}
      {/if}
      <div class="flex justify-end gap-2 pt-2">
        <Button variant="outline" onclick={() => (profileOpen = false)} disabled={usersApi.isLoading}>Cancel</Button>
        <Button onclick={submitProfile} loading={usersApi.isLoading} disabled={profileLoading}>Save profile</Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
