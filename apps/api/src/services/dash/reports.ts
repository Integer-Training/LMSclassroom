import type { Actor } from '@cio/db/actor';
import { AppError, ErrorCodes } from '@api/utils/errors';
import { isRole } from '@cio/utils/auth';
import { getOrgProgression } from '@api/services/progression/progression';
import {
  getCertificateStats,
  getCompletionsTrend,
  getCompletionStats,
  getLearnerLastReferral,
  getLearnerOpenReferCounts,
  getOrgCoursesWithEnrolment,
  getReferralLearnerBreakdown,
  getReferralTutorBreakdown,
  getTimeToCompleteStats
} from '@cio/db/queries/dash';
import { getOrgTutorFeedback, type OrgTutorFeedbackRow } from '@cio/db/queries/tutor-feedback';

// PearlLMS admin REPORTS — deep-dive operational reports for management (org-scoped, real data only). Admin
// or Manager. The Marking and Courses reports render off the existing getAdminOverview bundle; these two
// (Learners progression + Completions/certificates) need their own aggregates.

function assertManagerOrAdmin(actor: Actor): asserts actor is Extract<Actor, { authenticated: true }> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  if (!isRole(actor, 'ADMIN', 'MANAGER')) throw new AppError('Admins or managers only', ErrorCodes.FORBIDDEN, 403);
}

// The referrals report is ADMIN-ONLY (stricter than the other reports) — it exposes per-tutor strictness,
// which is management-sensitive. Managers/Tutors/Learners are denied.
function assertAdmin(actor: Actor): asserts actor is Extract<Actor, { authenticated: true }> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  if (!isRole(actor, 'ADMIN')) throw new AppError('Admins only', ErrorCodes.FORBIDDEN, 403);
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

// ── Referrals / failing report (ADMIN ONLY) ──────────────────────────────────────────────────────
// Everything about refers/failing: per-tutor (who entered the Refer → "strictness") and per-learner
// ("seriousness"). A "refer" = a non-passing coursework verdict; each resubmission is counted. See the
// query layer (getReferral* in @cio/db/queries/dash) for the exact counting rule. Read-only; org-scoped.
export interface ReferralsReport {
  totals: {
    totalRefers: number;
    learnersReferred: number;
    learnersCurrentlyReferred: number;
    tutorsReferring: number;
  };
  perTutor: {
    tutorId: string | null;
    name: string;
    learnersReferred: number;
    totalRefers: number;
    totalGraded: number;
    referRate: number; // percent, refers ÷ total graded
  }[];
  perLearner: {
    learnerId: string;
    name: string;
    timesReferred: number;
    unitsReferred: number;
    openRefers: number;
    lastReferredBy: string;
    lastReferredAt: string;
  }[];
}

/** Admin-only referrals/failing view: per-tutor strictness (grader-attributed) + per-learner seriousness. */
export async function getReferralsReport(actor: Actor): Promise<ReferralsReport> {
  assertAdmin(actor);
  const orgId = actor.orgId;

  const [tutorRows, learnerRows, openRows, lastRows] = await Promise.all([
    getReferralTutorBreakdown(orgId),
    getReferralLearnerBreakdown(orgId),
    getLearnerOpenReferCounts(orgId),
    getLearnerLastReferral(orgId)
  ]);

  const perTutor = tutorRows
    .filter((t) => t.totalRefers > 0) // the view is about refers — a grader who only ever passed is noise
    .map((t) => ({
      tutorId: t.tutorId,
      name: t.name ?? 'Removed grader',
      learnersReferred: t.learnersReferred,
      totalRefers: t.totalRefers,
      totalGraded: t.totalGraded,
      referRate: t.totalGraded > 0 ? Math.round((t.totalRefers / t.totalGraded) * 100) : 0
    }))
    .sort((a, b) => b.totalRefers - a.totalRefers || b.referRate - a.referRate);

  const openByLearner = new Map(openRows.map((o) => [o.learnerId, o.openRefers]));
  const lastByLearner = new Map(lastRows.map((l) => [l.learnerId, l]));

  const perLearner = learnerRows
    .map((l) => {
      const last = lastByLearner.get(l.learnerId);
      return {
        learnerId: l.learnerId,
        name: l.name ?? 'Unknown learner',
        timesReferred: l.timesReferred,
        unitsReferred: l.unitsReferred,
        openRefers: openByLearner.get(l.learnerId) ?? 0,
        // A referred learner always has a last-refer row: show the grader's name, or 'Removed grader' if that
        // tutor was since deleted (recorded_by null). '—' is only the defensive no-row case.
        lastReferredBy: last ? (last.lastReferredByName ?? 'Removed grader') : '—',
        lastReferredAt: last?.lastReferredAt ?? ''
      };
    })
    .sort((a, b) => b.timesReferred - a.timesReferred || b.openRefers - a.openRefers);

  return {
    totals: {
      totalRefers: perLearner.reduce((n, l) => n + l.timesReferred, 0),
      learnersReferred: perLearner.length,
      learnersCurrentlyReferred: openRows.length, // every openRows entry has ≥1 open refer by construction
      tutorsReferring: perTutor.length
    },
    perTutor,
    perLearner
  };
}

// ── Tutor feedback report (ADMIN ONLY) ────────────────────────────────────────────────────────────
// The admin-only view of the periodic learner→tutor feedback (Feature 2). Per-tutor averages (the headline
// — how learners rate each tutor) + the raw entries (so an admin can read the comments). Grouped by tutor id,
// falling back to the snapshot name when the tutor was since removed. Read-only; org-scoped. ADMIN only.
export interface TutorFeedbackReport {
  totals: {
    totalFeedback: number;
    tutorsRated: number;
    learnersResponded: number;
    avgOverall: number; // 0 when there is no feedback
  };
  perTutor: {
    tutorId: string | null;
    name: string;
    count: number;
    avgOverall: number;
    avgCommunication: number | null;
    avgHelpfulness: number | null;
    avgKnowledge: number | null;
  }[];
  entries: {
    id: string;
    learnerName: string;
    tutorName: string;
    milestone: number;
    overallRating: number;
    communicationRating: number | null;
    helpfulnessRating: number | null;
    knowledgeRating: number | null;
    comment: string | null;
    createdAt: string;
  }[];
}

/** Admin-only tutor-feedback view: per-tutor average ratings + the individual entries (with comments). */
export async function getTutorFeedbackReport(actor: Actor): Promise<TutorFeedbackReport> {
  assertAdmin(actor);
  const rows = await getOrgTutorFeedback(actor.orgId);

  const avg = (nums: number[]): number =>
    nums.length ? Math.round((nums.reduce((a, n) => a + n, 0) / nums.length) * 10) / 10 : 0;
  const avgNullable = (nums: (number | null)[]): number | null => {
    const vals = nums.filter((n): n is number => n != null);
    return vals.length ? avg(vals) : null;
  };

  // Group per tutor — by id, or by the snapshot name when the tutor was removed (tutorId null).
  const groups = new Map<string, OrgTutorFeedbackRow[]>();
  for (const r of rows) {
    const key = r.tutorId ?? `name:${r.tutorName}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const perTutor = Array.from(groups.values())
    .map((g) => ({
      tutorId: g[0].tutorId,
      name: g[0].tutorName,
      count: g.length,
      avgOverall: avg(g.map((r) => r.overallRating)),
      avgCommunication: avgNullable(g.map((r) => r.communicationRating)),
      avgHelpfulness: avgNullable(g.map((r) => r.helpfulnessRating)),
      avgKnowledge: avgNullable(g.map((r) => r.knowledgeRating))
    }))
    .sort((a, b) => b.avgOverall - a.avgOverall || b.count - a.count);

  const entries = rows.map((r) => ({
    id: r.id,
    learnerName: r.learnerName ?? 'Unknown learner',
    tutorName: r.tutorName,
    milestone: r.milestone,
    overallRating: r.overallRating,
    communicationRating: r.communicationRating,
    helpfulnessRating: r.helpfulnessRating,
    knowledgeRating: r.knowledgeRating,
    comment: r.comment,
    createdAt: r.createdAt
  }));

  return {
    totals: {
      totalFeedback: rows.length,
      tutorsRated: groups.size,
      learnersResponded: new Set(rows.map((r) => r.learnerId)).size,
      avgOverall: avg(rows.map((r) => r.overallRating))
    },
    perTutor,
    entries
  };
}
