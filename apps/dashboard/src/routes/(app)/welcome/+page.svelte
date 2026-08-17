<script lang="ts">
  import { ROUTE } from '$lib/utils/constants/routes';

  interface Props {
    data: { role: 'ADMIN' | 'MANAGER' | 'TUTOR' | 'LEARNER' };
  }

  let { data }: Props = $props();

  const COPY: Record<string, { title: string; body: string }> = {
    TUTOR: {
      title: 'Your caseload is ready',
      body: 'Head to your caseload to see the learners allocated to you and their coursework.'
    },
    MANAGER: {
      title: 'Your manager workspace is on the way',
      body: 'Provider-wide reports, tutor–learner allocation and registration approvals arrive in a later phase. There is nothing for you to do here yet.'
    }
  };

  const content = $derived(
    COPY[data.role] ?? {
      title: 'Welcome',
      body: 'There is nothing to show on this page for your role.'
    }
  );
</script>

<svelte:head>
  <title>Welcome — Pearl LMS</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-6">
  <div class="w-full max-w-md text-center">
    <p class="text-muted-foreground mb-2 text-xs font-medium tracking-widest uppercase">{data.role}</p>
    <h1 class="mb-3 text-2xl font-semibold">{content.title}</h1>
    <p class="text-muted-foreground mb-8 text-sm leading-relaxed">{content.body}</p>
    {#if data.role === 'TUTOR'}
      <a
        href="/caseload"
        class="bg-primary text-primary-foreground mb-4 inline-block rounded-md px-4 py-2 text-sm font-medium"
      >
        Go to my caseload
      </a>
      <div></div>
    {/if}
    <a href={ROUTE.LOGOUT} class="text-primary text-sm font-medium underline underline-offset-4"> Log out </a>
  </div>
</div>
