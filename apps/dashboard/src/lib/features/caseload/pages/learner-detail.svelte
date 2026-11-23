<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import MessageSquareIcon from '@lucide/svelte/icons/message-square';
  import { RESULT_LABELS, isPassingResult } from '@cio/utils/constants';
  import MarkingForm from '$features/caseload/components/marking-form.svelte';
  import { caseloadApi, type DetailFile } from '$features/caseload/api/caseload.svelte';
  import { messagingApi, type PreviousThread } from '$features/messaging/api/messaging.svelte';
  import EmailContact from '$features/messaging/components/email-contact.svelte';
  import { snackbar } from '$features/ui/snackbar/store';
  import { currentOrg } from '$lib/utils/store/org';

  function resultLabel(result: string | null): string {
    return result ? (RESULT_LABELS[result as keyof typeof RESULT_LABELS] ?? result) : '';
  }

  // Caseload learner detail (PearlLMS Phase 3 Step 4). Read-only version history per unit; files open
  // through the guarded coursework download endpoint. Server re-checks allocation for this learnerId.

  interface Props {
    learnerId: string;
  }
  let { learnerId }: Props = $props();

  // Archived threads with this learner's former tutors — readable (never writable) by the current tutor.
  let previousThreads = $state<PreviousThread[]>([]);

  onMount(() => {
    caseloadApi.loadLearner(learnerId);
    messagingApi.previousThreads(learnerId).then((list) => (previousThreads = list));
  });

  // PearlLMS Phase 8 — the markable submissions: the latest version of each (assessment, type) group that
  // has no result yet (matches the server mark-latest-per-type rule). A later draft never blocks a final.
  const markableIds = $derived.by(() => {
    const set = new Set<string>();
    const detail = caseloadApi.detail;
    if (!detail) return set;
    for (const course of detail.courses) {
      for (const unit of course.units) {
        const latestByGroup = new Map<string, (typeof unit.submissions)[number]>();
        for (const sub of unit.submissions) {
          const k = `${sub.assessmentKey ?? ''}::${sub.submissionType}`;
          const cur = latestByGroup.get(k);
          if (!cur || sub.version > cur.version) latestByGroup.set(k, sub);
        }
        for (const sub of latestByGroup.values()) {
          if (!sub.resultKind) set.add(sub.id);
        }
      }
    }
    return set;
  });

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString();
  }
  function formatSize(bytes: number | undefined): string {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${units[i]}`;
  }
  function open(courseId: string, lessonId: string, file: DetailFile) {
    caseloadApi.openFile(courseId, lessonId, file.key);
  }

  // PearlLMS Phase 6 Step 4 — open (or reuse) the thread with this allocated learner, then view it.
  // Message is TUTOR-only — the API refuses Admin/Manager, so the button isn't offered to them.
  const canMessage = $derived(($page.data.locals?.actor as { role?: string } | undefined)?.role === 'TUTOR');
  const emailSubject = $derived([$currentOrg.name, caseloadApi.detail?.learner.name].filter(Boolean).join(' — '));

  // Deep link from a notification: /caseload/<learnerId>#unit-<lessonId> scrolls to that unit, focuses it and
  // highlights it for 2s. Re-runs on a hash-only change; skipped for the reload that follows marking.
  let highlightId = $state<string | null>(null);
  let handledHash = '';
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const hash = $page.url.hash;
    const loaded = !!caseloadApi.detail;
    untrack(() => {
      if (!loaded || !hash.startsWith('#unit-') || hash === handledHash) return;
      handledHash = hash;
      void tick().then(() => {
        const lessonId = decodeURIComponent(hash.slice('#unit-'.length));
        const el = document.getElementById(`unit-${lessonId}`);
        if (!el) return;
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
        el.focus({ preventScroll: true });
        highlightId = lessonId;
        clearTimeout(highlightTimer);
        highlightTimer = setTimeout(() => (highlightId = null), 2000);
      });
    });
    // A different hash later (e.g. another notification) must be handled again.
    if (!hash.startsWith('#unit-')) handledHash = '';
  });
  onDestroy(() => clearTimeout(highlightTimer));

  let openingThread = $state(false);
  async function messageLearner() {
    if (openingThread) return;
    openingThread = true;
    try {
      const res = await messagingApi.startConversation(learnerId);
      if (!res) return;
      if ('error' in res) {
        snackbar.error(res.error);
        return;
      }
      await goto(`/messages/${res.threadId}`);
    } finally {
      openingThread = false;
    }
  }
</script>

<div class="mx-auto w-full max-w-4xl p-6">
  <a href="/caseload" class="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-sm">
    <ArrowLeftIcon class="size-4" /> Back to caseload
  </a>

  {#if !caseloadApi.detail}
    {#if caseloadApi.detailError === 'forbidden'}
      <div class="rounded-md border p-8 text-center" role="alert">
        <p class="font-medium">This learner is no longer in your caseload.</p>
        <Button href="/caseload" variant="outline" size="sm" class="mt-4">Back to caseload</Button>
      </div>
    {:else}
      <p class="text-muted-foreground text-sm">{caseloadApi.detailError ? 'Learner not found.' : 'Loading…'}</p>
    {/if}
  {:else}
    <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h1 class="text-xl font-semibold break-words">{caseloadApi.detail.learner.name || 'Learner'}</h1>
        {#if !caseloadApi.detail.learner.email}
          <p class="text-muted-foreground text-sm">No email address on file</p>
        {/if}
      </div>
      {#if canMessage}
        <Button variant="outline" size="sm" onclick={messageLearner} loading={openingThread}>
          <MessageSquareIcon class="size-4" /> Message
        </Button>
      {/if}
    </div>
    {#if caseloadApi.detail.learner.email}
      <div class="-mt-3 mb-6">
        <EmailContact
          email={caseloadApi.detail.learner.email}
          name={caseloadApi.detail.learner.name || 'learner'}
          subject={emailSubject}
        />
      </div>
    {/if}

    {#if previousThreads.length > 0}
      <div class="mb-6 rounded-md border p-4">
        <h2 class="text-sm font-semibold">Previous tutor messages</h2>
        <ul class="mt-2 space-y-1">
          {#each previousThreads as t (t.threadId)}
            <li>
              <a href={`/messages/${t.threadId}`} class="text-primary text-sm hover:underline">
                Conversation with {t.tutorName}
              </a>
              {#if t.lastAt}<span class="text-muted-foreground text-xs">
                  · last message {formatDate(t.lastAt)}</span
                >{/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if caseloadApi.detail.courses.length === 0}
      <div class="text-muted-foreground rounded-md border p-8 text-center text-sm">Nothing submitted yet.</div>
    {:else}
      <div class="space-y-6">
        {#each caseloadApi.detail.courses as course (course.courseId)}
          <div>
            <h2 class="text-muted-foreground mb-2 text-sm font-semibold tracking-wide uppercase">{course.title}</h2>
            <div class="space-y-4">
              {#each course.units as unit (unit.lessonId)}
                <div
                  id="unit-{unit.lessonId}"
                  tabindex="-1"
                  class="scroll-mt-20 rounded-md border transition-shadow outline-none motion-reduce:transition-none {highlightId ===
                  unit.lessonId
                    ? 'ring-primary ring-2'
                    : ''}"
                >
                  <div class="bg-muted/40 flex items-center justify-between gap-2 border-b px-4 py-2.5">
                    <span class="font-medium">{unit.title}</span>
                    <Badge variant={unit.state.awaitingMarking ? 'secondary' : 'outline'}>{unit.state.label}</Badge>
                  </div>
                  <ul class="divide-y">
                    {#each unit.submissions as sub, idx (sub.id)}
                      <li class="px-4 py-3">
                        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <span class="flex items-center gap-2 text-sm font-medium">
                            {sub.assessmentName} · v{sub.version}
                            <Badge variant="outline">{sub.submissionType === 'draft' ? 'Draft' : 'Final'}</Badge>
                          </span>
                          <div class="flex items-center gap-2">
                            {#if sub.resultKind === 'verdict' && sub.result}
                              <Badge variant={isPassingResult(sub.result) ? 'default' : 'destructive'}>
                                {resultLabel(sub.result)}
                              </Badge>
                            {:else if sub.resultKind === 'draft'}
                              <Badge variant="secondary">Draft feedback sent</Badge>
                            {/if}
                            <span class="text-muted-foreground text-xs">{formatDate(sub.submittedAt)}</span>
                          </div>
                        </div>
                        <ul class="space-y-1">
                          {#each sub.files as file (file.key)}
                            <li>
                              <button
                                type="button"
                                class="ui:text-primary inline-flex items-center gap-1.5 text-sm hover:underline"
                                onclick={() => open(course.courseId, unit.lessonId, file)}
                              >
                                <FileTextIcon class="size-4 shrink-0" />
                                <span class="truncate">{file.name}</span>
                                {#if file.size}<span class="text-muted-foreground text-xs"
                                    >({formatSize(file.size)})</span
                                  >{/if}
                              </button>
                            </li>
                          {/each}
                        </ul>
                        {#if sub.feedback || sub.feedbackFiles?.length}
                          <div class="bg-muted/40 mt-2 rounded-md p-2.5">
                            <p class="text-muted-foreground mb-0.5 text-xs font-medium">Feedback</p>
                            {#if sub.feedback}
                              <p class="text-sm whitespace-pre-wrap">{sub.feedback}</p>
                            {/if}
                            {#if sub.feedbackFiles?.length}
                              <ul class="mt-1.5 space-y-1">
                                {#each sub.feedbackFiles as file (file.key)}
                                  <li>
                                    <button
                                      type="button"
                                      class="ui:text-primary inline-flex items-center gap-1.5 text-sm hover:underline"
                                      onclick={() => open(course.courseId, unit.lessonId, file)}
                                    >
                                      <FileTextIcon class="size-4 shrink-0" />
                                      <span class="truncate">{file.name}</span>
                                      {#if file.size}<span class="text-muted-foreground text-xs"
                                          >({formatSize(file.size)})</span
                                        >{/if}
                                    </button>
                                  </li>
                                {/each}
                              </ul>
                            {/if}
                          </div>
                        {/if}
                        {#if markableIds.has(sub.id)}
                          <!-- Latest unmarked version of this assessment+type → grade it (allocated tutor /
                               Admin). A draft gets feedback only; a final gets Pass/Refer. -->
                          <MarkingForm
                            submissionId={sub.id}
                            isDraft={sub.submissionType === 'draft'}
                            onMarked={() => caseloadApi.loadLearner(learnerId)}
                          />
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>
