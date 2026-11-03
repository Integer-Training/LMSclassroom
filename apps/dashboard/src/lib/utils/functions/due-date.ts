// Assessment due dates are picked as a calendar day (<input type="date">) and stored as that day's UTC midnight,
// so the due DAY is the stored UTC date and it stays "due" until that day ends in the viewer's local time.
const DAY_MS = 86_400_000;

function dueDayStart(iso: string): Date | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** The due calendar day as a local date (so it never displays a day early west of UTC). */
export function dueDayDate(iso: string): Date | null {
  return dueDayStart(iso);
}

/** Whole local calendar days from today to the due day: 0 = due today, -1 = was due yesterday (overdue). */
export function daysUntilDue(iso: string, now: number = Date.now()): number | null {
  const due = dueDayStart(iso);
  if (!due) return null;
  const n = new Date(now);
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.round((due.getTime() - today.getTime()) / DAY_MS);
}

export function isOverdue(iso: string, now: number = Date.now()): boolean {
  const days = daysUntilDue(iso, now);
  return days !== null && days < 0;
}
