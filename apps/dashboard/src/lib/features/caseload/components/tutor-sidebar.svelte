<script lang="ts">
  import { page } from '$app/state';
  import * as Avatar from '@cio/ui/base/avatar';
  import * as Sidebar from '@cio/ui/base/sidebar';
  import { currentOrg } from '$lib/utils/store/org';
  import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
  import BookOpenIcon from '@lucide/svelte/icons/book-open';
  import TrendingUpIcon from '@lucide/svelte/icons/trending-up';

  // Tutor shell nav (PearlLMS Phase 8). Three flat items; Learner Progression is a disabled "Soon"
  // placeholder. Active state is derived from the current pathname.
  const items = $derived([
    {
      title: 'Dashboard',
      url: '/caseload',
      icon: LayoutDashboardIcon,
      isActive: page.url.pathname === '/caseload'
    },
    {
      title: 'My Courses',
      url: '/caseload/courses',
      icon: BookOpenIcon,
      isActive: page.url.pathname.startsWith('/caseload/courses')
    },
    {
      title: 'Learner Progression',
      url: '/caseload/progression',
      icon: TrendingUpIcon,
      isActive: page.url.pathname.startsWith('/caseload/progression')
    }
  ]);
</script>

<Sidebar.Root collapsible="icon">
  <Sidebar.Header>
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        <Sidebar.MenuButton size="lg">
          {#snippet child({ props })}
            <a href="/caseload" {...props}>
              <Avatar.Root class="ui:flex ui:size-8 ui:items-center ui:justify-center ui:rounded-md">
                <Avatar.Image src="/logo-192.png" alt="{$currentOrg.name || 'Home'} logo" />
              </Avatar.Root>
              <div class="grid flex-1 text-left text-sm leading-tight">
                <span class="truncate font-medium">{$currentOrg.name || 'Home'}</span>
                <span class="text-muted-foreground truncate text-xs">Tutor</span>
              </div>
            </a>
          {/snippet}
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Header>

  <Sidebar.Content>
    <Sidebar.Group>
      <Sidebar.Menu>
        {#each items as item (item.title)}
          <Sidebar.MenuItem>
            <Sidebar.MenuButton tooltipContent={item.title} isActive={item.isActive}>
              {#snippet child({ props })}
                {@const Icon = item.icon}
                <a href={item.url} {...props}>
                  <Icon size={16} />
                  <span>{item.title}</span>
                </a>
              {/snippet}
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
        {/each}
      </Sidebar.Menu>
    </Sidebar.Group>
  </Sidebar.Content>

  <Sidebar.Rail />
</Sidebar.Root>
