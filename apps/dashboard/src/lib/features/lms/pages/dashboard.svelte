<script lang="ts">
  import { goto } from '$app/navigation';
  import { Button } from '@cio/ui/base/button';
  import { Progress } from '@cio/ui/base/progress';
  import { Spinner } from '@cio/ui/base/spinner';
  import { currentOrg } from '$lib/utils/store/org';
  import { profile } from '$lib/utils/store/user';
  import { t } from '$lib/utils/functions/translations';
  import { coursesApi } from '$features/course/api';
  import { lmsDashboardApi } from '$features/lms/api/dashboard.svelte';
  import { announcementsApi } from '$features/announcements/api/announcements.svelte';
  import AnnouncementsList from '$features/announcements/components/announcements-list.svelte';
  import UpcomingSessionsCard from '$features/lms/components/upcoming-sessions-card.svelte';
  import StudyHoursChart from '$features/lms/components/study-hours-chart.svelte';
  import { getStudentCourseContinuePath } from '$features/course/utils/student-course-navigation';
  import BookOpenIcon from '@lucide/svelte/icons/book-open';
  import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
  import CheckCircle2Icon from '@lucide/svelte/icons/circle-check-big';
  import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
  import MailIcon from '@lucide/svelte/icons/mail';
  import InboxIcon from '@lucide/svelte/icons/inbox';
  import FlameIcon from '@lucide/svelte/icons/flame';
  import ClockIcon from '@lucide/svelte/icons/clock';
  import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
  import MessageSquareIcon from '@lucide/svelte/icons/message-square';
  import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
  import GraduationCapIcon from '@lucide/svelte/icons/graduation-cap';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import type { Component } from 'svelte';

  // PearlLMS — the learner HOME. Reference-style dense dashboard: welcome banner + quick actions, KPI tiles,
  // a progress summary ring, and a widget grid (My Tutor, Draft Feedbacks, News & Updates, Upcoming Due
  // Dates, Recent Messages, Course Progression, Study Hours). Powered by one aggregate GET /lms/dashboard
  // (plus the existing announcements feed + enrolled courses for live sessions). Explore-more-courses removed.

  const dash = $derived(lmsDashboardApi.data);
  const loaded = $derived(lmsDashboardApi.loaded);

  const firstName = $derived($profile.fullname?.trim().split(/\s+/)[0] || $t('dashboard.learner'));
  const initials = $derived(
    ($profile.fullname?.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('') || 'U').toUpperCase()
  );

  // Load guard is non-reactive so a failed load can retry on the next org/profile change without a loop.
  let loadedForOrg: string | null = null;
  $effect(() => {
    const profileId = $profile.id;
    const orgId = $currentOrg.id;
    if (!profileId || !orgId) return;
    if (loadedForOrg === orgId) return;
    loadedForOrg = orgId;
    lmsDashboardApi.load().then((res) => {
      if (!res) loadedForOrg = null;
    });
    announcementsApi.loadFeed();
    coursesApi.getEnrolledCourses();
  });

  // Upcoming LIVE sessions (kept from the previous home — genuinely time-sensitive).
  const upcomingSessions = $derived(
    coursesApi.enrolledCourses
      .filter((course) => course.type === 'LIVE_CLASS' && course.upcomingSession)
      .map((course) => ({
        lessonId: course.upcomingSession!.lessonId,
        courseTitle: course.title,
        lessonTitle: course.upcomingSession!.lessonTitle,
        callUrl: course.upcomingSession!.callUrl,
        lessonAt: course.upcomingSession!.lessonAt,
        timezone: course.upcomingSession!.sessionTimezone
      }))
      .sort((a, b) => new Date(a.lessonAt).getTime() - new Date(b.lessonAt).getTime())
  );

  interface Kpi {
    label: string;
    value: string | number;
    icon: Component;
    tone: string; // icon-chip colour classes
    href?: string;
  }
  const kpis = $derived.by<Kpi[]>(() => {
    const k = dash?.kpis;
    return [
      {
        label: 'Enrolled Courses',
        value: k?.enrolledCourses ?? 0,
        icon: BookOpenIcon,
        tone: 'bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400',
        href: '/lms/mylearning'
      },
      {
        label: 'Due Assignments',
        value: k?.dueAssignments ?? 0,
        icon: ClipboardListIcon,
        tone: 'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
        href: '/lms/exercises'
      },
      {
        label: 'Completed',
        value: k?.completed ?? 0,
        icon: CheckCircle2Icon,
        tone: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400'
      },
      {
        label: 'Overall Progress',
        value: `${k?.overallProgressPercent ?? 0}%`,
        icon: TrendingUpIcon,
        tone: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-950 dark:text-cyan-400'
      },
      {
        label: 'Unread Messages',
        value: k?.unreadMessages ?? 0,
        icon: MailIcon,
        tone: 'bg-purple-100 text-purple-600 dark:bg-purple-950 dark:text-purple-400',
        href: '/messages'
      }
    ];
  });

  // Progress ring geometry.
  const RING_R = 34;
  const RING_C = 2 * Math.PI * RING_R;
  const ringPercent = $derived(dash?.progressSummary.percent ?? 0);
  const ringOffset = $derived(RING_C - (ringPercent / 100) * RING_C);

  function fmtDate(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function relDays(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
    if (days < 0) return 'Overdue';
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return `in ${days} days`;
  }
  function timeAgo(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.floor(h / 24);
    return days === 1 ? '1 day ago' : `${days} days ago`;
  }
  function lessonHref(courseId: string, lessonId: string): string {
    return `/courses/${courseId}/lessons/${lessonId}`;
  }
</script>

<div class="space-y-5 pb-10">
  <!-- WELCOME BANNER -->
  <section class="overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 to-slate-800 p-5 text-white md:p-6">
    <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div class="flex items-center gap-4">
        <div class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/15 text-lg font-semibold">
          {initials}
        </div>
        <div>
          <h1 class="text-xl font-bold tracking-tight md:text-2xl">Welcome back, {firstName}</h1>
          <p class="mt-0.5 text-sm text-white/70">Here's your learning overview</p>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          onclick={() => goto('/lms/mylearning')}
          class="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium transition hover:bg-white/20"
        >
          <BookOpenIcon size={16} /> My Courses
        </button>
        <button
          onclick={() => goto('/messages')}
          class="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium transition hover:bg-white/20"
        >
          <InboxIcon size={16} /> Inbox
        </button>
        <button
          onclick={() => goto('/lms/exercises')}
          class="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium transition hover:bg-white/20"
        >
          <ClipboardListIcon size={16} /> Assessments
        </button>
      </div>
    </div>
  </section>

  {#if upcomingSessions.length}
    <UpcomingSessionsCard sessions={upcomingSessions} />
  {/if}

  <!-- KPI TILES -->
  <section class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
    {#each kpis as kpi (kpi.label)}
      {@const Icon = kpi.icon}
      {#snippet tile()}
        <div class="flex size-10 shrink-0 items-center justify-center rounded-lg {kpi.tone}">
          <Icon size={20} />
        </div>
        <div class="min-w-0">
          <p class="text-2xl leading-none font-semibold tabular-nums">
            {#if loaded}{kpi.value}{:else}<span class="text-muted-foreground">–</span>{/if}
          </p>
          <p class="text-muted-foreground mt-1 truncate text-xs font-medium">{kpi.label}</p>
        </div>
      {/snippet}
      {#if kpi.href}
        <button
          onclick={() => goto(kpi.href!)}
          class="bg-card hover:border-primary/40 flex cursor-pointer items-center gap-3 rounded-xl border p-4 text-left transition hover:shadow-sm"
        >
          {@render tile()}
        </button>
      {:else}
        <div class="bg-card flex items-center gap-3 rounded-xl border p-4 text-left">
          {@render tile()}
        </div>
      {/if}
    {/each}
  </section>

  <!-- PROGRESS SUMMARY -->
  <section class="bg-card rounded-xl border p-5">
    <div class="flex flex-col gap-6 sm:flex-row sm:items-center">
      <!-- ring -->
      <div class="relative flex size-24 shrink-0 items-center justify-center">
        <svg viewBox="0 0 80 80" class="size-24 -rotate-90">
          <circle cx="40" cy="40" r={RING_R} fill="none" stroke="currentColor" stroke-width="7" class="text-muted/30" />
          <circle
            cx="40"
            cy="40"
            r={RING_R}
            fill="none"
            stroke="currentColor"
            stroke-width="7"
            stroke-linecap="round"
            class="text-primary transition-all duration-700"
            stroke-dasharray={RING_C}
            stroke-dashoffset={ringOffset}
          />
        </svg>
        <div class="absolute flex flex-col items-center">
          <span class="text-xl font-bold tabular-nums">{ringPercent}%</span>
          <span class="text-muted-foreground text-[10px]">Complete</span>
        </div>
      </div>

      <!-- numbers -->
      <div class="flex flex-1 flex-wrap gap-x-8 gap-y-4">
        <div>
          <p class="text-2xl font-semibold tabular-nums">{dash?.progressSummary.courses ?? 0}</p>
          <p class="text-muted-foreground text-xs">Courses</p>
        </div>
        <div>
          <p class="text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {dash?.progressSummary.passedUnits ?? 0}
          </p>
          <p class="text-muted-foreground text-xs">Units passed</p>
        </div>
        <div>
          <p class="text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {Math.max((dash?.progressSummary.totalUnits ?? 0) - (dash?.progressSummary.passedUnits ?? 0), 0)}
          </p>
          <p class="text-muted-foreground text-xs">Units remaining</p>
        </div>

        <!-- extras -->
        <div class="flex items-center gap-2">
          <FlameIcon size={18} class="text-orange-500" />
          <div>
            <p class="text-2xl font-semibold tabular-nums">{dash?.kpis.streakDays ?? 0}</p>
            <p class="text-muted-foreground text-xs">Day streak</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <ClockIcon size={18} class="text-sky-500" />
          <div>
            <p class="text-2xl font-semibold tabular-nums">{dash?.kpis.awaitingMarking ?? 0}</p>
            <p class="text-muted-foreground text-xs">Awaiting marking</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <CalendarClockIcon size={18} class="text-rose-500" />
          <div>
            <p class="text-lg font-semibold">{relDays(dash?.kpis.nextDueAt ?? null)}</p>
            <p class="text-muted-foreground text-xs">Next due</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- MY TUTOR + DRAFT FEEDBACKS -->
  <div class="grid gap-4 lg:grid-cols-2">
    <!-- My Tutor -->
    <section class="bg-card overflow-hidden rounded-xl border">
      <div class="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-purple-500 px-4 py-3 text-white">
        <GraduationCapIcon size={16} /><h2 class="text-sm font-semibold">My Tutor</h2>
      </div>
      <div class="p-4">
        {#if dash?.tutor}
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <div class="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-full font-semibold">
                {dash.tutor.name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase()}
              </div>
              <div class="min-w-0">
                <p class="font-semibold">{dash.tutor.name}</p>
                {#if dash.tutor.email}
                  <p class="text-muted-foreground truncate text-xs">{dash.tutor.email}</p>
                {/if}
              </div>
            </div>
            <Button size="sm" onclick={() => goto('/messages')}>
              <MailIcon size={14} /> Contact Tutor
            </Button>
          </div>
        {:else}
          <p class="text-muted-foreground py-3 text-center text-sm">No tutor assigned yet.</p>
        {/if}
      </div>
    </section>

    <!-- Draft Feedbacks -->
    <section class="bg-card overflow-hidden rounded-xl border">
      <div class="flex items-center justify-between bg-gradient-to-r from-emerald-600 to-emerald-500 px-4 py-3 text-white">
        <div class="flex items-center gap-2"><MessageSquareIcon size={16} /><h2 class="text-sm font-semibold">Draft Feedbacks</h2></div>
        <span class="rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium">{dash?.draftFeedbacks.length ?? 0} total</span>
      </div>
      <div class="max-h-56 overflow-y-auto p-4">
        {#if dash && dash.draftFeedbacks.length > 0}
          <ul class="space-y-2">
            {#each dash.draftFeedbacks as f (f.courseId + f.lessonId + (f.assessmentKey ?? f.name))}
              <li>
                <a
                  href={lessonHref(f.courseId, f.lessonId)}
                  class="hover:border-primary/40 block rounded-lg border p-3 transition"
                >
                  <p class="text-sm font-medium">{f.name}</p>
                  <p class="text-muted-foreground truncate text-xs">{f.unitTitle} · {f.courseTitle}</p>
                  {#if f.feedback}
                    <p class="text-muted-foreground mt-1 line-clamp-2 text-xs italic">"{f.feedback}"</p>
                  {/if}
                </a>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="text-muted-foreground flex flex-col items-center justify-center gap-2 py-6 text-sm">
            <MessageSquareIcon size={26} class="opacity-30" /> No draft feedback yet
          </div>
        {/if}
      </div>
    </section>
  </div>

  <!-- NEWS & UPDATES -->
  {#if announcementsApi.items.length}
    <section class="bg-card overflow-hidden rounded-xl border">
      <div class="flex items-center gap-2 bg-gradient-to-r from-slate-800 to-slate-700 px-4 py-3 text-white">
        <MegaphoneIcon size={16} /><h2 class="text-sm font-semibold">News & Updates</h2>
      </div>
      <div class="p-4">
        <AnnouncementsList items={announcementsApi.items} showScope={false} />
      </div>
    </section>
  {/if}

  <!-- UPCOMING DUE DATES + RECENT MESSAGES -->
  <div class="grid gap-4 lg:grid-cols-2">
    <!-- Upcoming Due Dates -->
    <section class="bg-card overflow-hidden rounded-xl border">
      <div class="flex items-center justify-between bg-gradient-to-r from-slate-800 to-slate-700 px-4 py-3 text-white">
        <div class="flex items-center gap-2"><CalendarClockIcon size={16} /><h2 class="text-sm font-semibold">Upcoming Due Dates</h2></div>
        <span class="rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium">{dash?.upcomingDueDates.length ?? 0}</span>
      </div>
      <div class="max-h-64 overflow-y-auto p-4">
        {#if dash && dash.upcomingDueDates.length > 0}
          <ul class="space-y-2">
            {#each dash.upcomingDueDates as d (d.courseId + d.lessonId + (d.assessmentKey ?? d.name))}
              <li>
                <a href={lessonHref(d.courseId, d.lessonId)} class="hover:border-primary/40 flex items-center justify-between gap-3 rounded-lg border p-3 transition">
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium">{d.name}</p>
                    <p class="text-muted-foreground truncate text-xs">{d.unitTitle} · {d.courseTitle}</p>
                  </div>
                  <span
                    class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium {d.overdue
                      ? 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'}"
                  >
                    {d.overdue ? 'Overdue' : relDays(d.dueAt)}
                  </span>
                </a>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="text-muted-foreground flex flex-col items-center justify-center gap-2 py-8 text-sm">
            <CalendarClockIcon size={26} class="opacity-30" /> All caught up — nothing due.
          </div>
        {/if}
      </div>
    </section>

    <!-- Recent Messages -->
    <section class="bg-card overflow-hidden rounded-xl border">
      <div class="flex items-center justify-between bg-gradient-to-r from-slate-800 to-slate-700 px-4 py-3 text-white">
        <div class="flex items-center gap-2"><MessageSquareIcon size={16} /><h2 class="text-sm font-semibold">Recent Messages</h2></div>
        <button onclick={() => goto('/messages')} class="flex items-center gap-1 text-xs font-medium text-white/80 hover:text-white">
          View All <ArrowRightIcon size={12} />
        </button>
      </div>
      <div class="max-h-64 overflow-y-auto p-4">
        {#if dash && dash.recentMessages.length > 0}
          <ul class="space-y-2">
            {#each dash.recentMessages as m (m.threadId)}
              <li>
                <a href={`/messages/${m.threadId}`} class="hover:border-primary/40 block rounded-lg border p-3 transition">
                  <div class="flex items-center justify-between gap-2">
                    <p class="flex items-center gap-2 text-sm font-medium">
                      {#if m.unread}<span class="bg-primary size-2 shrink-0 rounded-full"></span>{/if}
                      {m.tutorName}
                    </p>
                    <span class="text-muted-foreground shrink-0 text-xs">{timeAgo(m.createdAt)}</span>
                  </div>
                  <p class="text-muted-foreground mt-1 line-clamp-1 text-xs">{m.body}</p>
                </a>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="text-muted-foreground flex flex-col items-center justify-center gap-2 py-8 text-sm">
            <MessageSquareIcon size={26} class="opacity-30" /> No messages yet.
          </div>
        {/if}
      </div>
    </section>
  </div>

  <!-- COURSE PROGRESSION -->
  <section class="bg-card overflow-hidden rounded-xl border">
    <div class="flex items-center justify-between bg-gradient-to-r from-slate-800 to-slate-700 px-4 py-3 text-white">
      <div class="flex items-center gap-2"><FileTextIcon size={16} /><h2 class="text-sm font-semibold">Course Progression</h2></div>
      <button onclick={() => goto('/lms/mylearning')} class="flex items-center gap-1 text-xs font-medium text-white/80 hover:text-white">
        View All <ArrowRightIcon size={12} />
      </button>
    </div>
    <div class="divide-border divide-y">
      {#if !loaded}
        <div class="text-muted-foreground flex items-center justify-center py-10"><Spinner class="size-6" /></div>
      {:else if dash && dash.courseProgression.length > 0}
        {#each dash.courseProgression as c (c.courseId)}
          <a href={getStudentCourseContinuePath(c.courseId)} class="hover:bg-muted/40 flex items-center gap-4 px-4 py-3 transition">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{c.title}</p>
              <p class="text-muted-foreground text-xs">{c.passed} of {c.total} passed{c.completed ? ' · Completed' : ''}</p>
            </div>
            <div class="flex w-40 shrink-0 items-center gap-3">
              <Progress value={c.percent} max={100} class="h-1.5 flex-1" />
              <span class="w-9 text-right text-xs font-semibold tabular-nums">{c.percent}%</span>
            </div>
          </a>
        {/each}
      {:else}
        <div class="text-muted-foreground flex flex-col items-center justify-center gap-2 py-10 text-sm">
          <BookOpenIcon size={26} class="opacity-30" /> You're not enrolled in any courses yet.
        </div>
      {/if}
    </div>
  </section>

  <!-- STUDY HOURS -->
  {#if dash}
    <StudyHoursChart monthly={dash.studyHours.monthly} totalSeconds={dash.studyHours.totalSeconds} year={dash.studyHours.year} />
  {/if}
</div>
