<script lang="ts">
  import LearnerDetail from '$features/caseload/pages/learner-detail.svelte';

  interface Props {
    data: { learnerId: string };
  }
  let { data }: Props = $props();
</script>

<svelte:head>
  <title>Learner — Pearl LMS</title>
</svelte:head>

{#key data.learnerId}
  <LearnerDetail learnerId={data.learnerId} />
{/key}
