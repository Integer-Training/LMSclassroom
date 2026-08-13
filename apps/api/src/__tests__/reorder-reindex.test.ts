import { describe, expect, it } from 'vitest';

import { reindexOrder } from '@cio/utils/functions/reorder';

// The reorder endpoints persist client-supplied `order` values verbatim, so the "clean sequence"
// guarantee (no gaps, no duplicates) lives in this pure helper. These tests assert that for ANY
// input ordering the result is a bijection over 0..n-1 in input order.

/** A result is "clean" iff its orders are exactly {0,1,...,n-1}, once each, matching array index. */
function assertCleanPermutation(result: Array<{ id: string; order: number }>) {
  const orders = result.map((r) => r.order);
  // contiguous 0..n-1, in order, no gaps or duplicates
  expect(orders).toEqual(result.map((_, i) => i));
  expect(new Set(orders).size).toBe(orders.length);
}

describe('reindexOrder — canonical 0-based ordering', () => {
  it('maps a straight list to 0..n-1 in order', () => {
    expect(reindexOrder(['a', 'b', 'c'])).toEqual([
      { id: 'a', order: 0 },
      { id: 'b', order: 1 },
      { id: 'c', order: 2 }
    ]);
  });

  it('produces a clean permutation for a reversed order', () => {
    const result = reindexOrder(['c', 'b', 'a']);
    assertCleanPermutation(result);
    expect(result.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('produces a clean permutation for an arbitrary shuffle', () => {
    const result = reindexOrder(['d', 'a', 'c', 'b', 'e']);
    assertCleanPermutation(result);
    expect(result.map((r) => r.id)).toEqual(['d', 'a', 'c', 'b', 'e']);
  });

  it('handles the single-item and empty cases', () => {
    expect(reindexOrder(['only'])).toEqual([{ id: 'only', order: 0 }]);
    expect(reindexOrder([])).toEqual([]);
  });

  it('drops duplicates and blanks so the output is always gap/duplicate-free', () => {
    const result = reindexOrder(['a', 'a', '', null, 'b', undefined, 'b', 'c']);
    expect(result).toEqual([
      { id: 'a', order: 0 },
      { id: 'b', order: 1 },
      { id: 'c', order: 2 }
    ]);
    assertCleanPermutation(result);
  });

  it('reindexes each phase independently — a cross-phase move leaves both phases clean', () => {
    // Simulate a unit moving from phase A to phase B: each phase is reindexed on its own id list.
    const phaseA = reindexOrder(['a1', 'a3']); // a2 moved out
    const phaseB = reindexOrder(['b1', 'a2', 'b2']); // a2 moved in, mid-list
    assertCleanPermutation(phaseA);
    assertCleanPermutation(phaseB);
    expect(phaseB.find((r) => r.id === 'a2')?.order).toBe(1);
  });
});
