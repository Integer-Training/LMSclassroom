<script lang="ts">
  import type { Component } from 'svelte';
  import type { AdminHeadline } from '$features/admin-dashboard/api/admin-dashboard.svelte';
  import UserMinusIcon from '@lucide/svelte/icons/user-minus';
  import AlarmClockIcon from '@lucide/svelte/icons/alarm-clock';
  import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
  import FileEditIcon from '@lucide/svelte/icons/file-pen-line';
  import UserPlusIcon from '@lucide/svelte/icons/user-plus';
  import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';

  interface Props {
    headline: AdminHeadline;
  }

  let { headline }: Props = $props();

  type Tone = 'danger' | 'warning' | 'muted';

  const toneClass: Record<Tone, string> = {
    danger: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    muted: 'bg-muted text-muted-foreground'
  };

  const cards = $derived<{ icon: Component; label: string; value: number; tone: Tone }[]>([
    { icon: UserMinusIcon, label: 'Inactive Learners', value: headline.inactiveLearners, tone: 'muted' },
    { icon: AlarmClockIcon, label: 'Overdue', value: headline.overdue, tone: 'danger' },
    { icon: CalendarClockIcon, label: 'Imminent Deadlines', value: headline.dueSoon, tone: 'warning' },
    { icon: FileEditIcon, label: 'Awaiting Draft Feedback', value: headline.awaitingDraftFeedback, tone: 'muted' },
    { icon: UserPlusIcon, label: 'Pending Registrations', value: headline.pendingRegistrations, tone: 'warning' },
    { icon: ShieldAlertIcon, label: 'Unverified IDs', value: headline.unverifiedLearners, tone: 'warning' }
  ]);
</script>

<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
  {#each cards as card (card.label)}
    <div class="bg-card flex items-center gap-3 rounded-xl border p-3">
      <div class={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${toneClass[card.tone]}`}>
        <card.icon class="h-4 w-4" />
      </div>
      <div class="min-w-0">
        <p class="text-2xl leading-none font-semibold tabular-nums">{card.value}</p>
        <p class="text-muted-foreground mt-1 text-xs">{card.label}</p>
      </div>
    </div>
  {/each}
</div>
