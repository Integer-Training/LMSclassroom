<script lang="ts">
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import * as Card from '@cio/ui/base/card';
  import { Button } from '@cio/ui/base/button';
  import { Password } from '@cio/ui/custom/password';
  import { classroomio } from '$lib/utils/services/api';
  import { profile } from '$lib/utils/store/user';
  import { currentOrg } from '$lib/utils/store/org';
  import { homeForRole } from '$lib/utils/functions/routes/homeForRole';

  // Force-change-on-first-login target. Admin-provisioned accounts are flagged mustChangePassword; the
  // init router sends them here until they set their own password (which clears the flag server-side).
  // On that forced first change the user has just signed in with the temporary password, so we don't ask for
  // it again (the API skips the check while the flag is set); a normal change still needs the current one.
  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let submitting = $state(false);
  let error = $state('');

  const mustChange = $derived(!!($profile?.settings as Record<string, unknown> | undefined)?.mustChangePassword);

  const canSubmit = $derived(
    (mustChange || !!currentPassword) && newPassword.length >= 8 && newPassword === confirmPassword && !submitting
  );

  async function submit() {
    error = '';
    if (newPassword.length < 8) {
      error = 'Your new password must be at least 8 characters.';
      return;
    }
    if (newPassword !== confirmPassword) {
      error = 'The new passwords do not match.';
      return;
    }
    submitting = true;
    try {
      const res = await classroomio.account['change-password'].$post({
        json: mustChange ? { newPassword } : { currentPassword, newPassword }
      });
      const body = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !body.success) {
        error = body.error || 'Could not change your password. Please try again.';
        return;
      }
      // Clear the flag locally so the gate won't loop, then go home.
      profile.update((p) => ({ ...p, settings: { ...((p.settings as object) ?? {}), mustChangePassword: false } }));
      const org = get(currentOrg);
      goto(homeForRole(org.roleId, org.siteName));
    } catch {
      error = 'Something went wrong. Please try again.';
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head><title>Change your password</title></svelte:head>

<div class="mx-auto flex min-h-[80vh] w-[92%] max-w-md items-center">
  <Card.Root class="w-full">
    <Card.Header>
      <Card.Title>Set a new password</Card.Title>
      <Card.Description>
        {#if mustChange}
          You're signed in with a temporary password. Choose your own password to continue.
        {:else}
          Choose a new password for your account.
        {/if}
      </Card.Description>
    </Card.Header>
    <Card.Content>
      <form
        class="flex flex-col gap-4"
        onsubmit={(e) => {
          e.preventDefault();
          if (canSubmit) submit();
        }}
      >
        {#if !mustChange}
          <div class="space-y-1">
            <span class="text-sm font-medium">Current password</span>
            <Password bind:value={currentPassword} autocomplete="current-password" placeholder="" />
          </div>
        {/if}
        <div class="space-y-1">
          <span class="text-sm font-medium">New password</span>
          <Password bind:value={newPassword} autocomplete="new-password" placeholder="" />
          <p class="text-muted-foreground text-xs">At least 8 characters.</p>
        </div>
        <div class="space-y-1">
          <span class="text-sm font-medium">Confirm new password</span>
          <Password bind:value={confirmPassword} autocomplete="new-password" placeholder="" />
          {#if confirmPassword && newPassword !== confirmPassword}
            <p class="text-destructive text-xs">The passwords don't match yet.</p>
          {/if}
        </div>
        {#if error}
          <p class="text-destructive text-sm">{error}</p>
        {/if}
        <Button type="submit" disabled={!canSubmit} loading={submitting}>Update password</Button>
      </form>
    </Card.Content>
  </Card.Root>
</div>
