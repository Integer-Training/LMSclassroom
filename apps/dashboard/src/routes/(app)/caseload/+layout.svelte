<script lang="ts">
  import * as Sidebar from '@cio/ui/base/sidebar';
  import TutorSidebar from '$features/caseload/components/tutor-sidebar.svelte';

  let { children } = $props();
</script>

<Sidebar.Provider>
  <TutorSidebar />

  <Sidebar.Inset>
    <header class="flex h-12 items-center border-b px-4">
      <Sidebar.Trigger />
    </header>

    <div class="mx-auto w-full max-w-6xl p-4 md:p-6">
      {@render children?.()}
    </div>
  </Sidebar.Inset>
</Sidebar.Provider>
