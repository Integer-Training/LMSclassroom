<script lang="ts">
  import { Separator } from '@cio/ui/base/separator';
  import * as Sidebar from '@cio/ui/base/sidebar';
  import Search from '../search.svelte';
  import LmsBreadcrumbs from './lms-breadcrumbs.svelte';
  import NotificationBell from '$features/notifications/components/notification-bell.svelte';

  interface Props {
    hideSearch?: boolean;
  }

  let { hideSearch = false }: Props = $props();
</script>

<header
  class="border-border ui:bg-background bg-background sticky top-0 z-50 flex h-12 w-full shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-8"
>
  <div class="flex w-full items-center gap-2 px-4">
    <Sidebar.Trigger />

    <div class="h-4 w-2">
      <Separator orientation="vertical" />
    </div>

    <LmsBreadcrumbs />

    <span class="grow"></span>

    {#if !hideSearch}
      <Search scope="lms" />
    {/if}

    <NotificationBell />
  </div>
</header>
