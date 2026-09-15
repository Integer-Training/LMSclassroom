<script lang="ts">
  import { onMount } from 'svelte';
  import * as Page from '@cio/ui/base/page';
  import * as Select from '@cio/ui/base/select';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { Textarea } from '@cio/ui/base/textarea';
  import AnnouncementsList from '$features/announcements/components/announcements-list.svelte';
  import { announcementsApi, type AnnouncementAudience } from '$features/announcements/api/announcements.svelte';

  // Admin broadcast compose + manage. Title + body + audience (all learners / all tutors / a course / a
  // learner / a tutor's learners). Publish-immediate; archive/delete to retract. The API enforces admin-only.

  let title = $state('');
  let body = $state('');
  let audience = $state<AnnouncementAudience>('all_learners');
  let courseId = $state('');
  let tutorId = $state('');
  let learnerId = $state('');
  let learnerName = $state('');
  let learnerSearch = $state('');
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  const AUDIENCE_OPTIONS: { value: AnnouncementAudience; label: string }[] = [
    { value: 'all_learners', label: 'All learners' },
    { value: 'all_tutors', label: 'All tutors' },
    { value: 'course', label: "A course's learners" },
    { value: 'learner', label: 'A specific learner' },
    { value: 'tutor', label: "A tutor's learners" }
  ];

  const audienceLabel = $derived(AUDIENCE_OPTIONS.find((o) => o.value === audience)?.label ?? 'All learners');
  const courseLabel = $derived(
    announcementsApi.courses.find((c) => c.courseId === courseId)?.title ?? 'Select a course'
  );
  const tutorLabel = $derived(announcementsApi.tutors.find((tu) => tu.id === tutorId)?.name ?? 'Select a tutor');

  const targetReady = $derived(
    audience === 'course' ? !!courseId : audience === 'tutor' ? !!tutorId : audience === 'learner' ? !!learnerId : true
  );
  const canPublish = $derived(!!title.trim() && !!body.trim() && targetReady && !announcementsApi.publishing);

  onMount(async () => {
    announcementsApi.reset();
    await Promise.all([announcementsApi.loadCourses(), announcementsApi.loadTutors(), announcementsApi.loadFeed()]);
  });

  function onLearnerSearchInput(value: string) {
    learnerSearch = value;
    learnerId = '';
    learnerName = '';
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (value.trim().length >= 2) announcementsApi.searchLearners(value.trim());
    }, 250);
  }

  function pickLearner(id: string, name: string) {
    learnerId = id;
    learnerName = name;
    learnerSearch = name;
    announcementsApi.learners = [];
  }

  async function publish() {
    if (!canPublish) return;
    const ok = await announcementsApi.publish({
      audienceType: audience,
      courseId: audience === 'course' ? courseId : null,
      targetUserId: audience === 'tutor' ? tutorId : audience === 'learner' ? learnerId : null,
      title: title.trim(),
      body: body.trim()
    });
    if (ok) {
      title = '';
      body = '';
      audience = 'all_learners';
      courseId = '';
      tutorId = '';
      learnerId = '';
      learnerName = '';
      learnerSearch = '';
    }
  }

  function onArchive(id: string, archived: boolean) {
    announcementsApi.setArchived(id, archived);
  }

  function onDelete(id: string) {
    if (confirm('Delete this broadcast for everyone? This cannot be undone.')) {
      announcementsApi.remove(id);
    }
  }
</script>

<svelte:head><title>Broadcasts</title></svelte:head>

<Page.Root class="mx-auto w-[92%] px-4 md:max-w-3xl">
  <Page.Header>
    <Page.HeaderContent><Page.Title>Broadcasts</Page.Title></Page.HeaderContent>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      <div class="flex flex-col gap-6">
        <div class="ui:border-border flex flex-col gap-3 rounded-lg border p-4">
          <span class="text-sm font-semibold">New broadcast</span>

          <div class="space-y-1">
            <label for="bc-title" class="text-sm font-medium">Title</label>
            <Input id="bc-title" bind:value={title} placeholder="e.g. Bank holiday closure" maxlength={200} />
          </div>

          <div class="space-y-1">
            <label for="bc-body" class="text-sm font-medium">Message</label>
            <Textarea id="bc-body" bind:value={body} placeholder="Write your broadcast…" rows={4} maxlength={5000} />
          </div>

          <div class="space-y-1">
            <label for="bc-audience" class="text-sm font-medium">Send to</label>
            <Select.Root type="single" bind:value={audience}>
              <Select.Trigger id="bc-audience" class="ui:w-full">{audienceLabel}</Select.Trigger>
              <Select.Content>
                {#each AUDIENCE_OPTIONS as opt (opt.value)}
                  <Select.Item value={opt.value}>{opt.label}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>

          {#if audience === 'course'}
            <div class="space-y-1">
              <label for="bc-course" class="text-sm font-medium">Course</label>
              <Select.Root type="single" bind:value={courseId}>
                <Select.Trigger id="bc-course" class="ui:w-full">{courseLabel}</Select.Trigger>
                <Select.Content>
                  {#each announcementsApi.courses as course (course.courseId)}
                    <Select.Item value={course.courseId}>{course.title ?? 'Untitled course'}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>
          {:else if audience === 'tutor'}
            <div class="space-y-1">
              <label for="bc-tutor" class="text-sm font-medium">Tutor</label>
              <Select.Root type="single" bind:value={tutorId}>
                <Select.Trigger id="bc-tutor" class="ui:w-full">{tutorLabel}</Select.Trigger>
                <Select.Content>
                  {#each announcementsApi.tutors as tutor (tutor.id)}
                    <Select.Item value={tutor.id}>{tutor.name ?? tutor.email ?? 'Tutor'}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
              <p class="ui:text-muted-foreground text-xs">Sends to every learner allocated to this tutor.</p>
            </div>
          {:else if audience === 'learner'}
            <div class="space-y-1">
              <label for="bc-learner" class="text-sm font-medium">Learner</label>
              <Input
                id="bc-learner"
                value={learnerSearch}
                oninput={(e) => onLearnerSearchInput(e.currentTarget.value)}
                placeholder="Search by name or email…"
                autocomplete="off"
              />
              {#if !learnerId && announcementsApi.learners.length > 0}
                <ul class="ui:border-border mt-1 max-h-48 overflow-y-auto rounded-md border">
                  {#each announcementsApi.learners as l (l.id)}
                    <li>
                      <button
                        type="button"
                        class="ui:hover:bg-muted flex w-full flex-col items-start px-3 py-2 text-left text-sm"
                        onclick={() => pickLearner(l.id, l.name)}
                      >
                        <span class="font-medium">{l.name}</span>
                        <span class="ui:text-muted-foreground text-xs">{l.email}</span>
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
              {#if learnerId}
                <p class="ui:text-muted-foreground text-xs">Selected: <strong>{learnerName}</strong></p>
              {/if}
            </div>
          {/if}

          <div class="flex justify-end">
            <Button onclick={publish} loading={announcementsApi.publishing} disabled={!canPublish}>Publish</Button>
          </div>
        </div>

        <div>
          <h2 class="mb-3 text-sm font-semibold">Sent broadcasts</h2>
          <AnnouncementsList
            items={announcementsApi.items}
            manage
            busyId={announcementsApi.busyId}
            emptyText="No broadcasts sent yet."
            {onArchive}
            {onDelete}
          />
        </div>
      </div>
    {/snippet}
  </Page.Body>
</Page.Root>
