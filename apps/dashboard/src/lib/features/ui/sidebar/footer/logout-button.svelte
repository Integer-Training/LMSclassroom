<script lang="ts">
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import LogOutIcon from '@lucide/svelte/icons/log-out';
  import * as Sidebar from '@cio/ui/base/sidebar';
  import { t } from '$lib/utils/functions/translations';

  // PearlLMS — a standalone, always-visible "Log out" button for the BOTTOM of every sidebar footer.
  // Self-contained (own Sidebar.Menu) so it drops into any Sidebar.Footer. Navigates to /logout, which
  // runs the full sign-out (authClient.signOut + app-state reset) and redirects to /login. The
  // tooltipContent surfaces the label when the rail collapses to icons.
  const label = $derived($t('settings.profile.logout'));
</script>

<Sidebar.Menu>
  <Sidebar.MenuItem>
    <Sidebar.MenuButton
      tooltipContent={label}
      class="ui:text-red-600 ui:hover:bg-red-50 ui:hover:text-red-700 ui:dark:text-red-400 ui:dark:hover:bg-red-950 ui:dark:hover:text-red-300"
      onclick={() => goto(resolve(`/logout`, {}))}
    >
      <LogOutIcon size={16} />
      <span>{label}</span>
    </Sidebar.MenuButton>
  </Sidebar.MenuItem>
</Sidebar.Menu>
