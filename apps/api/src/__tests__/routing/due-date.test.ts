import { describe, expect, it } from 'vitest';

import { daysUntilDue, dueDayDate, isOverdue } from '../../../../dashboard/src/lib/utils/functions/due-date';

// Stored form of a picked due date: that day's UTC midnight.
const DUE = '2026-11-10T00:00:00.000Z';
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

describe('due date handling', () => {
  it('is not overdue at any time on the due day (local)', () => {
    expect(isOverdue(DUE, local(2026, 11, 10, 0, 1))).toBe(false);
    expect(isOverdue(DUE, local(2026, 11, 10, 23, 59))).toBe(false);
    expect(daysUntilDue(DUE, local(2026, 11, 10, 12))).toBe(0);
  });

  it('becomes overdue the day after', () => {
    expect(isOverdue(DUE, local(2026, 11, 11, 0, 1))).toBe(true);
    expect(daysUntilDue(DUE, local(2026, 11, 11, 9))).toBe(-1);
  });

  it('counts days ahead', () => {
    expect(daysUntilDue(DUE, local(2026, 11, 7, 18))).toBe(3);
  });

  it('exposes the due day as the stored calendar date and rejects bad input', () => {
    const d = dueDayDate(DUE)!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 10, 10]);
    expect(dueDayDate('nope')).toBeNull();
    expect(isOverdue('nope')).toBe(false);
  });
});
