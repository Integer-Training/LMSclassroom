<script lang="ts">
  import { onMount } from 'svelte';
  import * as Sidebar from '@cio/ui/base/sidebar';
  import LmsHeader from '$features/ui/navigation/lms-header.svelte';
  import { LMSSidebar } from '$features/ui/sidebar/lms-sidebar';
  import TutorFeedbackDialog from '$features/lms/components/tutor-feedback-dialog.svelte';
  import { tutorFeedbackApi } from '$features/lms/api/tutor-feedback.svelte';

  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  // Every-N-units tutor-feedback prompt. "Due" is decided server-side; the client only throttles HOW OFTEN a
  // cancelled prompt reappears: at most MAX_SHOWS times for a given milestone (once per login), then it waits
  // for the next milestone. The per-milestone show count persists per device (localStorage); a per-session
  // flag stops it re-popping on in-app navigation within the same login.
  const MAX_SHOWS = 3;
  const COUNT_KEY = 'pearl.tutorFeedback.shows.v1'; // { [milestone]: timesShown }
  const SESSION_KEY = 'pearl.tutorFeedback.shownMilestone'; // milestone already shown this login

  let feedbackOpen = $state(false);

  function readCounts(): Record<string, number> {
    try {
      return JSON.parse(localStorage.getItem(COUNT_KEY) ?? '{}') as Record<string, number>;
    } catch {
      return {};
    }
  }

  onMount(async () => {
    await tutorFeedbackApi.loadStatus();
    const status = tutorFeedbackApi.status;
    const due = status?.dueMilestone;
    if (!due || !status?.tutor) return;

    try {
      if (sessionStorage.getItem(SESSION_KEY) === String(due)) return; // already shown this login
    } catch {
      // storage blocked — fall through and just show it once
    }

    const counts = readCounts();
    if ((counts[due] ?? 0) >= MAX_SHOWS) return; // capped — wait for the next milestone

    // Count this impression (one per login), then show.
    try {
      counts[due] = (counts[due] ?? 0) + 1;
      localStorage.setItem(COUNT_KEY, JSON.stringify(counts));
    } catch {
      // ignore unavailable/blocked storage
    }
    try {
      sessionStorage.setItem(SESSION_KEY, String(due));
    } catch {
      // ignore
    }
    feedbackOpen = true;
  });
</script>

<Sidebar.Provider>
  <LMSSidebar />

  <Sidebar.Inset>
    <LmsHeader />

    <div class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4">
      {@render children?.()}
    </div>
  </Sidebar.Inset>
</Sidebar.Provider>

{#if tutorFeedbackApi.status?.tutor}
  <TutorFeedbackDialog bind:open={feedbackOpen} tutorName={tutorFeedbackApi.status.tutor.name} />
{/if}
