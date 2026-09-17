import type { Actor } from '@cio/db/actor';
import { AppError, ErrorCodes } from '@api/utils/errors';
import { isRole } from '@cio/utils/auth';
import { getOrgProgression } from '@api/services/progression/progression';
import {
  getCertificateStats,
  getCompletionsTrend,
  getCompletionStats,
  getOrgCoursesWithEnrolment,
  getTimeToCompleteStats
} from '@cio/db/queries/dash';

// PearlLMS admin REPORTS — deep-dive operational reports for management (org-scoped, real data only). Admin
// or Manager. The Marking and Courses reports render off the existing getAdminOverview bundle; these two
// (Learners progression + Completions/certificates) need their own aggregates.

function assertManagerOrAdmin(actor: Actor): asserts actor is Extract<Actor, { authenticated: true }> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  if (!isRole(actor, 'ADMIN', 'MANAGER')) throw new AppError('Admins or managers only', ErrorCodes.FORBIDDEN, 403);
}

// ── Learners report ──────────────────────────────────────────────────────────────────────────────
export interface LearnersReport {
  total: number;
  activity: { created: number; active: number; inactive: number };
  avgProgress: number;
  distribution: { bucket: string; count: number }[];
  workbooks: { passed: number; total: number };
  caseStudies: { passed: number; total: number };
  newThisMonth: number;
  atRisk: { learnerId: string; name: string | null; percent: number; startDate: string | null }[];
}

/** Learner progression report: activity mix, progress distribution, assessment throughput, at-risk list. */
export async function getLearnersReport(actor: Actor): Promise<LearnersReport> {
  assertManagerOrAdmin(actor);
  const { rows } = await getOrgProgression(actor);

  const activity = { created: 0, active: 0, inactive: 0 };
  const buckets = { '0%': 0, '1–25%': 0, '26–50%': 0, '51–75%': 0, '76–99%': 0, '100%': 0 };
  const workbooks = { passed: 0, total: 0 };
  const caseStudies = { passed: 0, total: 0 };
  let percentSum = 0;
  let newThisMonth = 0;
  const monthStart = new Date(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1).getTime();
  const atRisk: LearnersReport['atRisk'] = [];

  for (const r of rows) {
    activity[r.activity]++;
    const p = r.currentPercent;
    percentSum += p;
    if (p <= 0) buckets['0%']++;
    else if (p <= 25) buckets['1–25%']++;
    else if (p <= 50) buckets['26–50%']++;
    else if (p <= 75) buckets['51–75%']++;
    else if (p < 100) buckets['76–99%']++;
    else buckets['100%']++;
    workbooks.passed += r.workbooks.passed;
    workbooks.total += r.workbooks.total;
    caseStudies.passed += r.caseStudies.passed;
    caseStudies.total += r.caseStudies.total;
    if (r.startDate && new Date(r.startDate).getTime() >= monthStart) newThisMonth++;
    // At risk = inactive (30d+ no login) and not yet finished.
    if (r.activity === 'inactive' && r.currentPercent < 100) {
      atRisk.push({ learnerId: r.learnerId, name: r.name, percent: r.currentPercent, startDate: r.startDate });
    }
  }

  atRisk.sort((a, b) => a.percent - b.percent);
  return {
    total: rows.length,
    activity,
    avgProgress: rows.length ? Math.round(percentSum / rows.length) : 0,
    distribution: Object.entries(buckets).map(([bucket, count]) => ({ bucket, count })),
    workbooks,
    caseStudies,
    newThisMonth,
    atRisk
  };
}

// ── Completions & certificates report ──────────────────────────────────────────────────────────
export interface CompletionsReport {
  totalCompletions: number;
  completionsThisMonth: number;
  certificates: { total: number; thisMonth: number };
  avgTimeToCompleteDays: number | null;
  completionsTrend: { month: number; count: number }[];
  byCourse: {
    courseId: string;
    title: string;
    enrolled: number;
    completed: number;
    rate: number;
    avgDays: number | null;
  }[];
}

/** Completions & certificates report: totals, monthly trend, per-course completion rate + time-to-complete. */
export async function getCompletionsReport(actor: Actor): Promise<CompletionsReport> {
  assertManagerOrAdmin(actor);
  const orgId = actor.orgId;
  const year = new Date().getUTCFullYear();

  const [trend, stats, certs, ttc, courses] = await Promise.all([
    getCompletionsTrend(orgId, year),
    getCompletionStats(orgId),
    getCertificateStats(orgId),
    getTimeToCompleteStats(orgId),
    getOrgCoursesWithEnrolment(orgId)
  ]);

  const completedByCourse = new Map(stats.byCourse.map((c) => [c.courseId, c.count]));
  const daysByCourse = new Map(ttc.byCourse.map((c) => [c.courseId, c.avgDays]));
  const byCourse = courses.map((c) => {
    const completed = completedByCourse.get(c.courseId) ?? 0;
    return {
      courseId: c.courseId,
      title: c.title ?? 'Untitled course',
      enrolled: c.enrolled,
      completed,
      rate: c.enrolled > 0 ? Math.round((completed / c.enrolled) * 100) : 0,
      avgDays: daysByCourse.get(c.courseId) ?? null
    };
  });

  return {
    totalCompletions: stats.total,
    completionsThisMonth: stats.thisMonth,
    certificates: certs,
    avgTimeToCompleteDays: ttc.avgDays,
    completionsTrend: trend,
    byCourse
  };
}
