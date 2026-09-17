import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { isRole } from '@cio/utils/auth';
import {
  getActiveBroadcastCount,
  getCourseEnrolledLearnerIds,
  getEnrollmentTrend,
  getCertificateStats,
  getCompletionStats,
  getIdVerificationBreakdown,
  getLessonCoursePairs,
  getMemberRoleStatusCounts,
  getOnlineOrgMembers,
  getOrgCoursesWithEnrolment,
  getOrgMessagingStats,
  getOrgStudyHoursMonthly,
  getPublishedCourseCount,
  getRegistrationFunnel,
  getSubmissionsOverTime,
  listOrgLearners
} from '@cio/db/queries/dash';
import { listLearnersForTutor } from '@cio/db/queries/allocation';
import { listOrgTutors } from '@cio/db/queries/comms';
import { getLastSeenForUserIds } from '@cio/db/queries/analytics';
import { getAssessmentItemsByLesson } from '@cio/db/queries/coursework';
import { getCourseProgressReport } from '@cio/db/queries/reports';
import { computePipelineForRoster } from '@api/services/caseload/caseload';
import { ROLE } from '@cio/utils/constants';

// PearlLMS admin dashboard service — the org-wide analytics bundle. Manager/Admin only (the route also
// guards). Everything is org-scoped via the org member set + course→group.organizationId joins, NOT
// tutor_allocation, so the numbers cover the WHOLE org. The marking/activity math reuses
// computePipelineForRoster (the same code the tutor pipeline uses) fed the org-wide learner roster.

const THIRTY_DAYS_MS = 30 * 86_400_000;
const ONLINE_WINDOW_MIN = 5;

function assertManagerOrAdmin(actor: Actor): asserts actor is Extract<Actor, { authenticated: true }> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  if (!isRole(actor, 'ADMIN', 'MANAGER')) {
    throw new AppError('Admins and managers only', ErrorCodes.FORBIDDEN, 403);
  }
}

export interface AdminHeadline {
  totalLearners: number;
  activeLearners: number;
  inactiveLearners: number;
  suspendedLearners: number;
  neverLoggedIn: number;
  learnersWithPendingWork: number;
  totalTutors: number;
  avgLearnersPerTutor: number;
  totalManagers: number;
  totalAdmins: number;
  activeCourses: number;
  awaitingMarking: number;
  overdue: number;
  dueSoon: number;
  awaitingDraftFeedback: number;
  resubmissions: number;
  totalGraded: number;
  passCount: number;
  referCount: number;
  passRate: number | null;
  avgTurnaroundDays: number | null;
  pendingRegistrations: number;
  unverifiedLearners: number;
  activeBroadcasts: number;
  openThreads: number;
  messagesLast7d: number;
  completionsThisMonth: number;
  certificatesEarned: number;
  activeLearners7d: number;
  activeLearners30d: number;
}

export interface TutorPerfRow {
  tutorId: string;
  name: string | null;
  email: string | null;
  learners: number;
  awaitingMarking: number;
  inactiveLearners: number;
  avgTurnaroundDays: number | null;
  passRate: number | null;
}

export interface CoursePerfRow {
  courseId: string;
  title: string;
  isPublished: boolean;
  enrolled: number;
  active30d: number;
  assessments: number;
  completionPercent: number;
}

export interface AdminOverview {
  generatedAt: string;
  headline: AdminHeadline;
  charts: {
    learnerStatus: { active: number; inactive: number; suspended: number; neverLoggedIn: number };
    enrollmentTrend: { month: number; count: number }[];
    submissionsTrend: { month: number; count: number }[];
    studyHoursMonthly: { month: number; hours: number }[];
    outcomes: { passCount: number; referCount: number; passRate: number | null };
    registrationFunnel: { pending: number; approved: number; rejected: number };
    idVerification: { verified: number; failed: number; notVerified: number };
  };
  tutors: TutorPerfRow[];
  courses: CoursePerfRow[];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** The full admin dashboard bundle. Cached by the route (~60s). */
export async function getAdminOverview(actor: Actor): Promise<AdminOverview> {
  assertManagerOrAdmin(actor);
  const orgId = actor.orgId;
  const year = new Date().getUTCFullYear();

  // Org-wide learner roster (all STUDENT members) — the roster the pipeline math runs over.
  const learners = await listOrgLearners(orgId);
  const learnerRoster = learners.map((l) => ({ learnerId: l.learnerId, name: l.name, email: l.email }));
  const learnerIds = learners.map((l) => l.learnerId);

  const [
    orgPipeline,
    roleCounts,
    activeCourses,
    enrollmentTrend,
    submissionsTrend,
    studyRows,
    funnelRows,
    idRows,
    messaging,
    activeBroadcasts,
    tutors,
    coursesBase,
    courseEnrolments,
    lastSeen,
    completionStats,
    certStats
  ] = await Promise.all([
    computePipelineForRoster(learnerRoster),
    getMemberRoleStatusCounts(orgId),
    getPublishedCourseCount(orgId),
    getEnrollmentTrend(orgId, year),
    getSubmissionsOverTime(orgId, year),
    getOrgStudyHoursMonthly(orgId, year),
    getRegistrationFunnel(orgId),
    getIdVerificationBreakdown(orgId),
    getOrgMessagingStats(orgId),
    getActiveBroadcastCount(orgId),
    listOrgTutors(orgId),
    getOrgCoursesWithEnrolment(orgId),
    getCourseEnrolledLearnerIds(orgId),
    getLastSeenForUserIds(learnerIds),
    getCompletionStats(orgId),
    getCertificateStats(orgId)
  ]);

  // Org-wide active learners in the last 7 / 30 days (from the shared last-seen map).
  const nowMs = Date.now();
  const SEVEN_DAYS_MS = 7 * 86_400_000;
  let activeLearners7d = 0;
  let activeLearners30d = 0;
  for (const id of learnerIds) {
    const seen = lastSeen.get(id);
    if (!seen) continue;
    const age = nowMs - new Date(seen).getTime();
    if (age <= SEVEN_DAYS_MS) activeLearners7d++;
    if (age <= THIRTY_DAYS_MS) activeLearners30d++;
  }

  const s = orgPipeline.stats;

  // Role tallies from the grouped role/status counts.
  const totalOf = (roleId: number) => roleCounts.filter((r) => r.roleId === roleId).reduce((n, r) => n + r.count, 0);
  const totalTutors = totalOf(ROLE.TUTOR);
  const totalManagers = totalOf(ROLE.MANAGER);
  const totalAdmins = totalOf(ROLE.ADMIN);

  // Registration funnel.
  const funnelOf = (status: string) => funnelRows.find((r) => r.status === status)?.count ?? 0;
  const registrationFunnel = {
    pending: funnelOf('pending'),
    approved: funnelOf('approved'),
    rejected: funnelOf('rejected')
  };

  // ID verification: rows only exist for touched learners; the rest are implicitly not_verified.
  const idOf = (status: string) => idRows.find((r) => r.status === status)?.count ?? 0;
  const verified = idOf('verified');
  const failed = idOf('failed');
  const notVerified = learners.length - verified - failed;
  const idVerification = { verified, failed, notVerified: Math.max(0, notVerified) };

  // Study hours per month (seconds → hours), 12 points.
  const studyByMonth = new Map(studyRows.map((r) => [Number(r.yearMonth.slice(5, 7)), r.seconds]));
  const studyHoursMonthly = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    hours: round1((studyByMonth.get(i + 1) ?? 0) / 3600)
  }));

  // Per-course active-in-30d from the shared last-seen map.
  const now = Date.now();
  const activeByCourse = new Map<string, number>();
  for (const { courseId, learnerId } of courseEnrolments) {
    const seen = lastSeen.get(learnerId);
    if (seen && now - new Date(seen).getTime() <= THIRTY_DAYS_MS) {
      activeByCourse.set(courseId, (activeByCourse.get(courseId) ?? 0) + 1);
    }
  }

  // Per-course assessment counts (lesson→course pairs → assessment items per lesson, summed per course).
  const lessonPairs = await getLessonCoursePairs(coursesBase.map((c) => c.courseId));
  const itemsByLesson = await getAssessmentItemsByLesson(lessonPairs.map((p) => p.lessonId));
  const assessmentsByCourse = new Map<string, number>();
  for (const { lessonId, courseId } of lessonPairs) {
    const n = itemsByLesson.get(lessonId)?.length ?? 0;
    if (n) assessmentsByCourse.set(courseId, (assessmentsByCourse.get(courseId) ?? 0) + n);
  }

  // Per-course completion% (pass-based) — only for published courses to bound the work.
  const completionByCourse = new Map<string, number>();
  await Promise.all(
    coursesBase
      .filter((c) => c.isPublished)
      .map(async (c) => {
        const report = await getCourseProgressReport(c.courseId);
        const completed = report.rows.filter((r) => r.completed).length;
        completionByCourse.set(c.courseId, pct(completed, report.rows.length));
      })
  );

  const courses: CoursePerfRow[] = coursesBase.map((c) => ({
    courseId: c.courseId,
    title: c.title,
    isPublished: c.isPublished,
    enrolled: c.enrolled,
    active30d: activeByCourse.get(c.courseId) ?? 0,
    assessments: assessmentsByCourse.get(c.courseId) ?? 0,
    completionPercent: completionByCourse.get(c.courseId) ?? 0
  }));

  // Per-tutor performance — run the same pipeline math over each tutor's allocated roster.
  const tutorRows: TutorPerfRow[] = await Promise.all(
    tutors.map(async (t) => {
      const roster = await listLearnersForTutor(t.id);
      const p = await computePipelineForRoster(roster);
      const graded = p.stats.passCount + p.stats.referCount;
      return {
        tutorId: t.id,
        name: t.name,
        email: t.email,
        learners: p.stats.learners,
        awaitingMarking: p.stats.awaitingMarking,
        inactiveLearners: p.stats.inactiveLearners,
        avgTurnaroundDays: p.stats.avgTurnaroundDays,
        passRate: graded > 0 ? pct(p.stats.passCount, graded) : null
      };
    })
  );
  tutorRows.sort((a, b) => b.learners - a.learners);

  const graded = s.passCount + s.referCount;
  const headline: AdminHeadline = {
    totalLearners: learners.length,
    activeLearners: s.activeLearners,
    inactiveLearners: s.inactiveLearners,
    suspendedLearners: s.suspendedLearners,
    neverLoggedIn: s.neverLoggedIn,
    learnersWithPendingWork: s.learnersWithPendingWork,
    totalTutors,
    avgLearnersPerTutor: totalTutors > 0 ? round1(learners.length / totalTutors) : 0,
    totalManagers,
    totalAdmins,
    activeCourses,
    awaitingMarking: s.awaitingMarking,
    overdue: s.overdue,
    dueSoon: s.dueSoon,
    awaitingDraftFeedback: s.awaitingDraftFeedback,
    resubmissions: s.resubmissions,
    totalGraded: s.totalGraded,
    passCount: s.passCount,
    referCount: s.referCount,
    passRate: graded > 0 ? pct(s.passCount, graded) : null,
    avgTurnaroundDays: s.avgTurnaroundDays,
    pendingRegistrations: registrationFunnel.pending,
    unverifiedLearners: Math.max(0, learners.length - verified),
    activeBroadcasts,
    openThreads: messaging.activeThreads,
    messagesLast7d: messaging.messagesLast7d,
    completionsThisMonth: completionStats.thisMonth,
    certificatesEarned: certStats.total,
    activeLearners7d,
    activeLearners30d
  };

  return {
    generatedAt: new Date().toISOString(),
    headline,
    charts: {
      learnerStatus: {
        active: s.activeLearners,
        inactive: s.inactiveLearners,
        suspended: s.suspendedLearners,
        neverLoggedIn: s.neverLoggedIn
      },
      enrollmentTrend,
      submissionsTrend,
      studyHoursMonthly,
      outcomes: { passCount: s.passCount, referCount: s.referCount, passRate: headline.passRate },
      registrationFunnel,
      idVerification
    },
    tutors: tutorRows,
    courses
  };
}

export interface OnlineNow {
  count: number;
  byRole: { learners: number; tutors: number; managers: number; admins: number };
  users: { userId: string; name: string | null; email: string | null; role: string; lastActive: string }[];
}

const ROLE_LABEL: Record<number, string> = { 1: 'Admin', 2: 'Tutor', 3: 'Learner', 4: 'Manager' };

/** The near-live "Online now" panel (session refreshed within 5 minutes). Polled separately, uncached. */
export async function getOnlineNow(actor: Actor): Promise<OnlineNow> {
  assertManagerOrAdmin(actor);
  const rows = await getOnlineOrgMembers(actor.orgId, ONLINE_WINDOW_MIN);
  const byRole = { learners: 0, tutors: 0, managers: 0, admins: 0 };
  for (const r of rows) {
    if (r.roleId === ROLE.STUDENT) byRole.learners++;
    else if (r.roleId === ROLE.TUTOR) byRole.tutors++;
    else if (r.roleId === ROLE.MANAGER) byRole.managers++;
    else if (r.roleId === ROLE.ADMIN) byRole.admins++;
  }
  return {
    count: rows.length,
    byRole,
    users: rows.map((r) => ({
      userId: r.userId,
      name: r.name,
      email: r.email,
      role: ROLE_LABEL[r.roleId] ?? 'Member',
      lastActive: r.lastActive
    }))
  };
}
