import { ContentType } from '@cio/utils/constants/content';
import type { CourseContentItem, CourseContentSection } from './types';

// Pure helpers (no Svelte imports) so the learner-view content rules can be unit-tested from apps/api.

/**
 * The exercise page is admin-only, so learners must never be offered an exercise (outline row, sidebar tree,
 * Prev/Next, Continue). Pure copy of the content with every exercise item removed; sections are kept.
 */
export function withoutExercises<T extends { items: CourseContentItem[]; sections: CourseContentSection[] }>(
  content: T
): T {
  const keep = (item: CourseContentItem) => item.type !== ContentType.Exercise;
  return {
    ...content,
    items: content.items.filter(keep),
    sections: content.sections.map((section) => ({ ...section, items: section.items.filter(keep) }))
  };
}

/**
 * Where "Continue" should land a learner: the server-computed current position when it is known and still
 * unlocked in the outline, else the first not-yet-complete unlocked lesson (exercises never count for learners).
 */
export function resolveContinueTarget(
  items: CourseContentItem[],
  currentLessonId: string | null | undefined
): CourseContentItem | undefined {
  const lessons = items.filter((item) => item.type === ContentType.Lesson);
  if (currentLessonId) {
    const current = lessons.find((item) => item.id === currentLessonId && item.isUnlocked !== false);
    if (current) return current;
  }
  return lessons.find((item) => !item.isComplete && item.isUnlocked === true);
}
