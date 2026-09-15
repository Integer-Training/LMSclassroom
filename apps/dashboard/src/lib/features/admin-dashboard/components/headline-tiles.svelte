<script lang="ts">
  import KpiCard from '$features/analytics/components/kpi-card.svelte';
  import type { AdminHeadline } from '$features/admin-dashboard/api/admin-dashboard.svelte';
  import UsersIcon from '@lucide/svelte/icons/users';
  import GraduationCapIcon from '@lucide/svelte/icons/graduation-cap';
  import BookOpenIcon from '@lucide/svelte/icons/book-open';
  import ClipboardCheckIcon from '@lucide/svelte/icons/clipboard-check';
  import UserPlusIcon from '@lucide/svelte/icons/user-plus';
  import AwardIcon from '@lucide/svelte/icons/award';
  import ClockIcon from '@lucide/svelte/icons/clock';
  import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
  import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
  import MessageSquareIcon from '@lucide/svelte/icons/message-square';

  interface Props {
    headline: AdminHeadline;
    loading?: boolean;
  }

  let { headline, loading = false }: Props = $props();
</script>

<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
  <KpiCard
    title="Total Learners"
    value={headline.totalLearners}
    description={`${headline.activeLearners} active · ${headline.inactiveLearners} inactive · ${headline.suspendedLearners} suspended`}
    icon={UsersIcon}
    accent="primary"
    {loading}
  />
  <KpiCard
    title="Total Tutors"
    value={headline.totalTutors}
    description={`avg ${headline.avgLearnersPerTutor}/tutor`}
    icon={GraduationCapIcon}
    accent="primary"
    {loading}
  />
  <KpiCard title="Active Courses" value={headline.activeCourses} icon={BookOpenIcon} accent="primary" {loading} />
  <KpiCard
    title="Awaiting Marking"
    value={headline.awaitingMarking}
    description={`${headline.overdue} overdue · ${headline.dueSoon} due soon`}
    icon={ClipboardCheckIcon}
    accent="warning"
    {loading}
  />
  <KpiCard
    title="Pending Registrations"
    value={headline.pendingRegistrations}
    icon={UserPlusIcon}
    accent="primary"
    {loading}
  />
</div>

<div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
  <KpiCard
    title="Pass Rate"
    value={headline.passRate !== null ? `${headline.passRate}%` : 'N/A'}
    icon={AwardIcon}
    accent="success"
    {loading}
  />
  <KpiCard
    title="Avg Turnaround"
    value={headline.avgTurnaroundDays !== null ? `${headline.avgTurnaroundDays}d` : 'N/A'}
    icon={ClockIcon}
    accent="primary"
    {loading}
  />
  <KpiCard
    title="Active Broadcasts"
    value={headline.activeBroadcasts}
    icon={MegaphoneIcon}
    accent="primary"
    {loading}
  />
  <KpiCard
    title="Unverified IDs"
    value={headline.unverifiedLearners}
    icon={ShieldAlertIcon}
    accent="warning"
    {loading}
  />
  <KpiCard
    title="Open Message Threads"
    value={headline.openThreads}
    description={`${headline.messagesLast7d} messages · last 7d`}
    icon={MessageSquareIcon}
    accent="primary"
    {loading}
  />
</div>
