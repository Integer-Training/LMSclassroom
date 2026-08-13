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
