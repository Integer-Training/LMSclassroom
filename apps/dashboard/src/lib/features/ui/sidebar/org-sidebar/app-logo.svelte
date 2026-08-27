<script lang="ts">
  import * as Avatar from '@cio/ui/base/avatar';
  import * as Sidebar from '@cio/ui/base/sidebar';
  import { currentOrg } from '$lib/utils/store/org';
  import { Badge } from '@cio/ui/base/badge';
  import { PLAN_NAMES, PLAN } from '@cio/utils/plans';
  import { homeForRole } from '$lib/utils/functions/routes/homeForRole';

  const plan = $derived($currentOrg.plans?.[0]?.planName || PLAN.BASIC);
  // PearlLMS: the logo is a HOME link to the user's own dashboard (role-aware), not an external marketing site.
  const home = $derived(homeForRole($currentOrg.roleId, $currentOrg.siteName));
</script>

<Sidebar.Menu>
  <Sidebar.MenuItem>
    <Sidebar.MenuButton
      size="sm"
      class="ui:data-[state=open]:bg-sidebar-accent ui:data-[state=open]:text-sidebar-accent-foreground"
    >
      {#snippet child({ props })}
        <a href={home} {...props}>
          <Avatar.Root class="ui:flex ui:size-6 ui:items-center ui:justify-center">
            <Avatar.Image src="/logo-192.png" alt="{$currentOrg.name || 'Home'} logo" />
          </Avatar.Root>

          <span class="truncate font-normal">{$currentOrg.name || 'Home'}</span>
          <Badge variant="outline" class="capitalize">
            {PLAN_NAMES[plan] || plan}
          </Badge>
        </a>
      {/snippet}
    </Sidebar.MenuButton>
  </Sidebar.MenuItem>
</Sidebar.Menu>
