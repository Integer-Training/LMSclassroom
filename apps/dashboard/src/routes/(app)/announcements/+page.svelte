<script lang="ts">
  import { onMount } from 'svelte';
  import * as Page from '@cio/ui/base/page';
  import * as Select from '@cio/ui/base/select';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { Textarea } from '@cio/ui/base/textarea';
  import AnnouncementsList from '$features/announcements/components/announcements-list.svelte';
  import { announcementsApi } from '$features/announcements/api/announcements.svelte';

  // Staff compose (Admin/Manager). Title + body + scope (provider-wide, or a published course). Publish-
  // immediate — no drafts, no scheduling.
  const WIDE = 'wide';
  let title = $state('');
  let body = $state('');
  let scope = $state(WIDE);

  const scopeLabel = $derived(
    scope === WIDE
      ? 'Everyone (provider-wide)'
      : (announcementsApi.courses.find((c) => c.courseId === scope)?.title ?? 'Course')
  );

  onMount(async () => {
    announcementsApi.reset();
    await Promise.all([announcementsApi.loadCourses(), announcementsApi.loadFeed()]);
  });

  async function publish() {
    if (!title.trim() || !body.trim() || announcementsApi.publishing) return;
    const ok = await announcementsApi.publish({
      courseId: scope === WIDE ? null : scope,
      title: title.trim(),
      body: body.trim()
    });
    if (ok) {
      title = '';
      body = '';
      scope = WIDE;
    }
  }
</script>

<svelte:head><title>Announcements</title></svelte:head>

<Page.Root class="mx-auto w-[92%] px-4 md:max-w-3xl">
  <Page.Header>
    <Page.HeaderContent><Page.Title>Announcements</Page.Title></Page.HeaderContent>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      <div class="flex flex-col gap-6">
        <div class="ui:border-border flex flex-col gap-3 rounded-lg border p-4">
          <span class="text-sm font-semibold">New announcement</span>
          <div class="space-y-1">
            <label for="an-title" class="text-sm font-medium">Title</label>
            <Input id="an-title" bind:value={title} placeholder="e.g. Bank holiday closure" maxlength={200} />
          </div>
          <div class="space-y-1">
            <label for="an-body" class="text-sm font-medium">Message</label>
            <Textarea id="an-body" bind:value={body} placeholder="Write your announcement…" rows={4} maxlength={5000} />
          </div>
          <div class="space-y-1">
            <label for="an-scope" class="text-sm font-medium">Send to</label>
            <Select.Root type="single" bind:value={scope}>
              <Select.Trigger id="an-scope" class="ui:w-full">{scopeLabel}</Select.Trigger>
              <Select.Content>
                <Select.Item value={WIDE}>Everyone (provider-wide)</Select.Item>
                {#each announcementsApi.courses as course (course.courseId)}
                  <Select.Item value={course.courseId}>{course.title ?? 'Untitled course'}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
          <div class="flex justify-end">
            <Button onclick={publish} loading={announcementsApi.publishing} disabled={!title.trim() || !body.trim()}>
              Publish
            </Button>
          </div>
        </div>

        <div>
          <h2 class="mb-3 text-sm font-semibold">Published</h2>
          <AnnouncementsList items={announcementsApi.items} />
        </div>
      </div>
    {/snippet}
  </Page.Body>
</Page.Root>
