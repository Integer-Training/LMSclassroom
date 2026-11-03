<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { LessonPage } from '$features/course/pages';
  import { lessonApi } from '$features/course/api';
  import { profile } from '$lib/utils/store/user';
  import type { Lesson } from '$features/course/utils/types';
  import * as Page from '@cio/ui/base/page';

  interface Props {
    data: {
      courseId: string;
      lessonId: string;
      lesson: Lesson | null;
    };
  }

  let { data }: Props = $props();

  // Fresh loads carry freshly signed document URLs; the singleton would otherwise keep expired ones on revisit.
  // Edit mode keeps the in-memory lesson so unsaved changes aren't overwritten.
  let appliedLesson: Lesson | null = null;

  $effect(() => {
    if (!data.lessonId) return;

    if (!data.lesson) {
      if (lessonApi.lesson?.id === data.lessonId) {
        lessonApi.lesson = null;
      }

      return;
    }

    const lesson = data.lesson;
    const alreadyLoaded = untrack(() => lessonApi.lesson?.id === lesson.id);
    if (alreadyLoaded && (page.url.searchParams.get('mode') === 'edit' || appliedLesson === lesson)) return;
    appliedLesson = lesson;
    lessonApi.linksSignedAt = Date.now();

    // Set lesson data
    lessonApi.lesson = lesson;

    // Set translations if lesson has lessonLanguages
    if (lesson.lessonLanguages) {
      lessonApi.setTranslations();
    }

    // Set current locale from profile if available
    if ($profile.locale) {
      lessonApi.currentLocale = $profile.locale;
    }
  });
</script>

<Page.Root class="mx-auto flex w-[90%] px-4 md:max-w-4xl lg:max-w-5xl">
  {#key data.lessonId}
    <LessonPage courseId={data.courseId} lessonId={data.lessonId} />
  {/key}
</Page.Root>
