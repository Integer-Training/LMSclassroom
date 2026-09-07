<script lang="ts">
  import { ExercisesPage } from '$features/lms/pages';
  import * as Page from '@cio/ui/base/page';
</script>

<svelte:head>
  <title>Assessments</title>
</svelte:head>

<Page.Root class="w-full">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>Assessments</Page.Title>
      <p class="text-muted-foreground text-sm">Your workbooks and case studies across all your courses.</p>
    </Page.HeaderContent>
  </Page.Header>
  <Page.Body>
    {#snippet child()}
      <ExercisesPage />
    {/snippet}
  </Page.Body>
</Page.Root>
