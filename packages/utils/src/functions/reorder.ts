// Canonical sequence-ordering helper (PearlLMS Phase 2).
//
// The course/section and lesson reorder endpoints persist whatever `order` values the client sends
// verbatim (no server-side reindex). So the "no gaps, no duplicates" guarantee for a unit/phase
// sequence is the CLIENT's responsibility. This is the single place that turns a post-drag ordering
// of ids into the canonical `{ id, order }[]` payload: `order` is exactly the item's index, giving a
// clean contiguous `0..n-1` permutation every time — including after arbitrary moves within a phase
// or across phases (each phase is reindexed independently by calling this per group).

export interface OrderedItem {
  id: string;
  order: number;
}

/**
 * Map an ordered list of ids to `{ id, order }` pairs where `order` is the 0-based position.
 * Blank/duplicate ids are dropped so the result is always a clean bijection over `0..n-1`.
 */
export function reindexOrder(orderedIds: Array<string | null | undefined>): OrderedItem[] {
  const seen = new Set<string>();
  const result: OrderedItem[] = [];

  for (const id of orderedIds) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, order: result.length });
  }

  return result;
}

export interface UnitDisplayOrder {
  sectionOrder: number | null;
  lessonOrder: number | null;
  createdAt: string | Date | null;
}

/**
 * The ONE canonical order units are displayed in — section order, then lesson order (a null order sorts
 * first, as index 0), then authoring order (`createdAt`). Mirrors `buildCourseContent`'s comparator so every
 * surface (admin content, learner course view, tutor course view, progression, sequential-unlock gating)
 * lists units the way the admin arranged them. NEVER tie-break on the lesson UUID — that scrambles units
 * that share or lack an `order` (e.g. "Unit 2" jumping above "Unit 1").
 */
export function compareUnitDisplayOrder(a: UnitDisplayOrder, b: UnitDisplayOrder): number {
  const bySection = (a.sectionOrder ?? 0) - (b.sectionOrder ?? 0);
  if (bySection !== 0) return bySection;
  const byLesson = (a.lessonOrder ?? 0) - (b.lessonOrder ?? 0);
  if (byLesson !== 0) return byLesson;
  const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return at - bt;
}
