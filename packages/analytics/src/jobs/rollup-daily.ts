import {
  selectCountryDailyAggregates,
  selectLatestOrgDailyRollupDate,
  selectCourseDailyAggregates,
  selectOrgDailyAggregates,
  upsertCountryDailyRows,
  upsertCourseDailyRows,
  upsertOrgDailyRows
} from '@cio/db/queries/analytics';

type RollupResult = {
  windowStart: string;
  windowEnd: string;
  orgRows: number;
  courseRows: number;
  countryRows: number;
};

/**
 * Compute UTC midnight boundaries for the day `daysAgo` before today.
 * daysAgo=1 → yesterday (full day window).
 */
function getDayBoundsUtc(daysAgo: number): { startIso: string; endIso: string } {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
  const next = new Date(target);
  next.setUTCDate(next.getUTCDate() + 1);
  return { startIso: target.toISOString(), endIso: next.toISOString() };
}

/** The most days a single catch-up run will roll up (bounded so a long outage cannot turn into one huge job). */
export const ROLLUP_MAX_CATCH_UP_DAYS = 14;

/**
 * How many days back the catch-up must start so every day since the last rolled-up day (up to yesterday) is covered:
 * `1` when up to date or never rolled up, capped at ROLLUP_MAX_CATCH_UP_DAYS. Yesterday is always included (it is
 * re-rolled idempotently, which also picks up late events).
 */
export function computeCatchUpDays(latestRolledDate: string | null, now: Date = new Date()): number {
  if (!latestRolledDate) return 1;

  const latest = Date.parse(`${latestRolledDate}T00:00:00.000Z`);
  if (Number.isNaN(latest)) return 1;

  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysSinceLatest = Math.round((todayUtc - latest) / 86_400_000);

  return Math.min(ROLLUP_MAX_CATCH_UP_DAYS, Math.max(1, daysSinceLatest - 1));
}

/**
 * Daily scheduled run: roll up yesterday plus any days missed since the last rollup (max 14), oldest first.
 * Idempotent (UPSERT), so an overlapping or repeated run is harmless.
 */
export async function runAnalyticsRollupCatchUp(): Promise<RollupResult[]> {
  const days = computeCatchUpDays(await selectLatestOrgDailyRollupDate());
  const results: RollupResult[] = [];

  for (let daysAgo = days; daysAgo >= 1; daysAgo -= 1) {
    results.push(await runAnalyticsRollupDaily({ daysAgo }));
  }

  return results;
}

/**
 * Aggregates raw page events into the daily rollup tables (org / course /
 * country) for a single UTC day window. Idempotent — UPSERT keyed on the
 * unique constraints. Safe to re-run.
 *
 * Default window: yesterday (00:00–24:00 UTC).
 */
export async function runAnalyticsRollupDaily(opts: { daysAgo?: number } = {}): Promise<RollupResult> {
  const daysAgo = opts.daysAgo ?? 1;
  const { startIso, endIso } = getDayBoundsUtc(daysAgo);

  const [orgAgg, courseAgg, countryAgg] = await Promise.all([
    selectOrgDailyAggregates(startIso, endIso),
    selectCourseDailyAggregates(startIso, endIso),
    selectCountryDailyAggregates(startIso, endIso)
  ]);

  const orgRows = orgAgg
    .filter((row) => row.orgId)
    .map((row) => ({
      orgId: row.orgId as string,
      date: row.date,
      landingViews: row.landingViews,
      uniqueVisitors: row.uniqueVisitors,
      coursePageViews: row.coursePageViews,
      enrollments: row.enrollments,
      completions: row.completions
    }));

  const courseRows = courseAgg
    .filter((row) => row.courseId && row.orgId)
    .map((row) => ({
      courseId: row.courseId as string,
      orgId: row.orgId as string,
      date: row.date,
      views: row.views,
      uniqueVisitors: row.uniqueVisitors,
      enrollments: row.enrollments,
      completions: row.completions
    }));

  const countryRows = countryAgg
    .filter((row) => row.orgId && row.country)
    .map((row) => ({
      orgId: row.orgId as string,
      date: row.date,
      country: row.country as string,
      views: row.views,
      enrollments: row.enrollments
    }));

  const [orgWritten, courseWritten, countryWritten] = await Promise.all([
    upsertOrgDailyRows(orgRows),
    upsertCourseDailyRows(courseRows),
    upsertCountryDailyRows(countryRows)
  ]);

  return {
    windowStart: startIso,
    windowEnd: endIso,
    orgRows: orgWritten,
    courseRows: courseWritten,
    countryRows: countryWritten
  };
}
