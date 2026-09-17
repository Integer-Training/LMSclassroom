<script lang="ts">
  import { Separator } from '@cio/ui/base/separator';
  import * as Sidebar from '@cio/ui/base/sidebar';
  import AppBreadcrumbs from './app-breadcrumbs.svelte';
  import HeaderContext from './header-context.svelte';
  import NotificationBell from '$features/notifications/components/notification-bell.svelte';
</script>

<header
  class="border-border ui:bg-background sticky top-0 z-50 flex h-12 w-full shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-8"
>
  <div class="flex w-full items-center gap-2 px-4">
    <Sidebar.Trigger />

    <div class="h-4 w-2">
      <Separator orientation="vertical" />
    </div>

    <AppBreadcrumbs />

    <span class="grow"></span>

    <HeaderContext />

    <NotificationBell />
  </div>
</header>
