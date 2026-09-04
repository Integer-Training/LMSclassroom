import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { isPassingResult } from '@cio/utils/constants';
import { listAllocatedLearnersForOrg, listLearnersForTutor, type AllocatedLearner } from '@cio/db/queries/allocation';
import {
  getCoursesForLearners,
  getEnrolmentsForLearners,
  getProfileStatusForIds,
  getUnitTimeForLearners,
  type LearnerEnrolment
} from '@cio/db/queries/caseload';
import { computeLearnerCourseProgress } from '@cio/db/queries/progress';
import { getOrderedUnitsForCourse } from '@cio/db/queries/gating';
import {
  getAssessmentItemsByLesson,
  getSubmissionsWithContextForLearners,
  type SubmissionWithContext
} from '@cio/db/queries/coursework';
import { getLatestMarkedResultsForCourse } from '@cio/db/queries/reports';
import { getLastSeenForUserIds } from '@cio/db/queries/analytics';
import { isAllocatedTutor } from '@api/middlewares/guards';

// Tutor Learner-Progression (PearlLMS Phase 9) — read-only view of allocated learners' progress across
// courses, composed from the shared progress/coursework/time primitives. Roster is allocation-sourced
// (Admin = org-wide union, Tutor = own), mirroring getTutorPipeline; the detail path re-checks roster
// membership so a caller cannot reach a learner outside their caseload by tampering with the id.

const THIRTY_DAYS_MS = 30 * 86_400_000;

export type ActivityStatus = 'created' | 'active' | 'inactive';

export interface KindCount {
  passed: number;
  total: number;
}

export interface ProgressionRow {
  learnerId: string;
  name: string | null;
  /** Earliest enrolment date across the learner's courses, or null. */
  startDate: string | null;
  activity: ActivityStatus;
  /** Percent of the TARGET course (0 if the learner has no target course). */
  currentPercent: number;
  /** 1-based position badge of the target course's current unit, or null. */
  currentUnitIndex: number | null;
  workbooks: KindCount;
  caseStudies: KindCount;
}

export interface ProgressionList {
  courses: { courseId: string; title: string }[];
  rows: ProgressionRow[];
}

export interface SubmissionDetail {
  assessmentName: string;
  kind: string;
  documentName: string;
  documentKey: string | null;
  submittedAt: string;
  markedAt: string | null;
  status: string;
}

export interface UnitDetail {
  lessonId: string;
  unitTitle: string;
  timeSeconds: number;
  submissions: SubmissionDetail[];
}

export interface CourseDetail {
  courseId: string;
  title: string;
  percent: number;
  workbooks: KindCount;
  caseStudies: KindCount;
  totalTimeSeconds: number;
  units: UnitDetail[];
}

export interface ProgressionDetail {
  learner: { id: string; name: string | null };
  courses: CourseDetail[];
}

/** The caller's roster — allocation-sourced (Admin = org, Tutor = own). Mirrors getTutorPipeline. */
async function loadRoster(actor: Actor): Promise<AllocatedLearner[]> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  if (actor.role !== 'ADMIN' && actor.role !== 'TUTOR') {
    throw new AppError('You do not have a caseload', ErrorCodes.FORBIDDEN, 403);
  }
  return actor.role === 'ADMIN' ? listAllocatedLearnersForOrg(actor.orgId) : listLearnersForTutor(actor.userId);
}

interface CatalogItem {
  lessonId: string;
  key: string;
}
interface CourseCatalog {
  workbook: CatalogItem[];
  casestudy: CatalogItem[];
}

/** A course's assessment items split by the two counted kinds (workbook / casestudy). One-per-course load. */
async function buildCourseCatalog(courseId: string): Promise<CourseCatalog> {
  const units = await getOrderedUnitsForCourse(courseId);
  const itemsByLesson = await getAssessmentItemsByLesson(units.map((u) => u.lessonId));
  const workbook: CatalogItem[] = [];
  const casestudy: CatalogItem[] = [];
  for (const u of units) {
    for (const item of itemsByLesson.get(u.lessonId) ?? []) {
      if (item.kind === 'workbook') workbook.push({ lessonId: u.lessonId, key: item.key });
      else if (item.kind === 'casestudy') casestudy.push({ lessonId: u.lessonId, key: item.key });
    }
  }
  return { workbook, casestudy };
}

/** Passing (learner,lesson,assessment) keys for a whole course as a Set — one batched read per course. */
async function buildCoursePassSet(courseId: string): Promise<Set<string>> {
  const rows = await getLatestMarkedResultsForCourse(courseId);
  const set = new Set<string>();
  for (const r of rows) {
    if (isPassingResult(r.result)) set.add(`${r.learnerId}::${r.lessonId}::${r.assessmentKey ?? ''}`);
  }
  return set;
}

/** How many of `items` this learner has passed (of their total). */
function countKind(items: CatalogItem[], learnerId: string, passSet: Set<string>): KindCount {
  let passed = 0;
  for (const it of items) {
    if (passSet.has(`${learnerId}::${it.lessonId}::${it.key}`)) passed++;
  }
  return { passed, total: items.length };
}

function activityOf(status: string | undefined, lastSeen: string | null | undefined, now: number): ActivityStatus {
  // DEACTIVATED learners are excluded upstream; this only classifies the surviving rows.
  if (!lastSeen) return 'created';
  return now - new Date(lastSeen).getTime() > THIRTY_DAYS_MS ? 'inactive' : 'active';
}

/**
 * The progression table: one row per non-deactivated roster learner. Each row's metrics are for the learner's
 * TARGET course — the `courseId` query param if given (learners not enrolled in it are dropped), otherwise the
 * learner's PRIMARY course (most-recent enrolment). `courses` is the roster's distinct courses (the filter
 * dropdown). Learners with no courses appear at 0% / 0-of-0.
 */
export async function getProgression(actor: Actor, courseId?: string): Promise<ProgressionList> {
  const roster = await loadRoster(actor);
  const rosterIds = roster.map((l) => l.learnerId);

  const [statusMap, lastSeen, enrolments, rosterCourses] = await Promise.all([
    getProfileStatusForIds(rosterIds),
    getLastSeenForUserIds(rosterIds),
    getEnrolmentsForLearners(rosterIds),
    getCoursesForLearners(rosterIds)
  ]);

  const courses = rosterCourses.map((c) => ({ courseId: c.courseId, title: c.title }));

  // Enrolments grouped per learner, and the derived start-date + target course per learner.
  const enrolByLearner = new Map<string, LearnerEnrolment[]>();
  for (const e of enrolments) {
    const arr = enrolByLearner.get(e.learnerId);
    if (arr) arr.push(e);
    else enrolByLearner.set(e.learnerId, [e]);
  }
  const earliest = (arr: LearnerEnrolment[]): string | null => {
    let out: string | null = null;
    for (const e of arr) {
      if (!e.enrolledAt) continue;
      if (!out || new Date(e.enrolledAt).getTime() < new Date(out).getTime()) out = e.enrolledAt;
    }
    return out;
  };
  const primaryCourse = (arr: LearnerEnrolment[]): string | null => {
    let out: LearnerEnrolment | null = null;
    for (const e of arr) {
      if (!out) out = e;
      else if (new Date(e.enrolledAt ?? 0).getTime() > new Date(out.enrolledAt ?? 0).getTime()) out = e;
    }
    return out?.courseId ?? null;
  };

  const now = Date.now();

  // Decide each surviving learner's target course, then batch the per-course catalog + pass set once.
  interface Pending {
    learner: AllocatedLearner;
    startDate: string | null;
    activity: ActivityStatus;
    targetCourseId: string | null;
  }
  const pending: Pending[] = [];
  for (const learner of roster) {
    if (statusMap.get(learner.learnerId) === 'DEACTIVATED') continue;
    const arr = enrolByLearner.get(learner.learnerId) ?? [];
    // A course filter restricts the table to learners enrolled in that course.
    if (courseId && !arr.some((e) => e.courseId === courseId)) continue;
    const targetCourseId = courseId ?? primaryCourse(arr);
    pending.push({
      learner,
      startDate: earliest(arr),
      activity: activityOf(statusMap.get(learner.learnerId), lastSeen.get(learner.learnerId), now),
      targetCourseId
    });
  }

  const targetCourseIds = [...new Set(pending.map((p) => p.targetCourseId).filter((id): id is string => !!id))];
  const catalogs = new Map<string, CourseCatalog>();
  const passSets = new Map<string, Set<string>>();
  await Promise.all(
    targetCourseIds.map(async (cid) => {
      const [catalog, passSet] = await Promise.all([buildCourseCatalog(cid), buildCoursePassSet(cid)]);
      catalogs.set(cid, catalog);
      passSets.set(cid, passSet);
    })
  );

  const rows: ProgressionRow[] = [];
  for (const p of pending) {
    let currentPercent = 0;
    let currentUnitIndex: number | null = null;
    let workbooks: KindCount = { passed: 0, total: 0 };
    let caseStudies: KindCount = { passed: 0, total: 0 };

    if (p.targetCourseId) {
      const progress = await computeLearnerCourseProgress(p.learner.learnerId, p.targetCourseId);
      currentPercent = progress.total > 0 ? Math.round((progress.passed / progress.total) * 100) : 0;
      currentUnitIndex = progress.currentPosition?.index ?? null;

      const catalog = catalogs.get(p.targetCourseId);
      const passSet = passSets.get(p.targetCourseId) ?? new Set<string>();
      if (catalog) {
        workbooks = countKind(catalog.workbook, p.learner.learnerId, passSet);
        caseStudies = countKind(catalog.casestudy, p.learner.learnerId, passSet);
      }
    }

    rows.push({
      learnerId: p.learner.learnerId,
      name: p.learner.name,
      startDate: p.startDate,
      activity: p.activity,
      currentPercent,
      currentUnitIndex,
      workbooks,
      caseStudies
    });
  }

  return { courses, rows };
}

/**
 * One learner's full progression detail — every course they're enrolled in, with per-course percent /
 * workbook+case-study counts / total active time, and the ordered units (each with time + the submissions'
 * document, submit/mark dates and status). The learner MUST be in the caller's roster (else 403 — the
 * URL-tamper defence, mirroring the caseload learner-detail canRead rule).
 */
export async function getProgressionDetail(actor: Actor, learnerId: string): Promise<ProgressionDetail> {
  const roster = await loadRoster(actor);
  const inRoster = roster.find((l) => l.learnerId === learnerId);
  // Defense-in-depth: a Tutor must be allocated (roster membership already proves it); an Admin's roster is
  // the org-wide allocated union. Either way, not-in-roster is a hard 403. (loadRoster guarantees the actor
  // is authenticated here; the `actor.authenticated` check just re-narrows the union for the role read.)
  const tutorNotAllocated =
    actor.authenticated && actor.role === 'TUTOR' && !(await isAllocatedTutor(actor, learnerId));
  if (!inRoster || tutorNotAllocated) {
    throw new AppError('This learner is not in your caseload', ErrorCodes.FORBIDDEN, 403);
  }

  const [enrolments, subs, timeRows] = await Promise.all([
    getEnrolmentsForLearners([learnerId]),
    getSubmissionsWithContextForLearners([learnerId]),
    getUnitTimeForLearners([learnerId])
  ]);

  // Time keyed per (course, lesson) so a lesson id reused across courses stays distinct.
  const timeByCourseLesson = new Map<string, number>();
  for (const r of timeRows) timeByCourseLesson.set(`${r.courseId}::${r.lessonId}`, r.seconds);

  // Submissions grouped per (course, lesson), preserving the newest-first order the query returns.
  const subsByCourseLesson = new Map<string, SubmissionWithContext[]>();
  for (const s of subs) {
    const key = `${s.courseId}::${s.lessonId}`;
    const arr = subsByCourseLesson.get(key);
    if (arr) arr.push(s);
    else subsByCourseLesson.set(key, [s]);
  }

  // Courses = the learner's distinct enrolments, earliest first (nulls last), then by title for determinism.
  const orderedEnrolments = [...enrolments].sort((a, b) => {
    const ta = a.enrolledAt ? new Date(a.enrolledAt).getTime() : Number.MAX_SAFE_INTEGER;
    const tb = b.enrolledAt ? new Date(b.enrolledAt).getTime() : Number.MAX_SAFE_INTEGER;
    return ta - tb || a.title.localeCompare(b.title);
  });

  const courses: CourseDetail[] = [];
  for (const enr of orderedEnrolments) {
    const cid = enr.courseId;
    const [progress, units, catalog, passSet] = await Promise.all([
      computeLearnerCourseProgress(learnerId, cid),
      getOrderedUnitsForCourse(cid),
      buildCourseCatalog(cid),
      buildCoursePassSet(cid)
    ]);
    const percent = progress.total > 0 ? Math.round((progress.passed / progress.total) * 100) : 0;
    const workbooks = countKind(catalog.workbook, learnerId, passSet);
    const caseStudies = countKind(catalog.casestudy, learnerId, passSet);

    const itemsByLesson = await getAssessmentItemsByLesson(units.map((u) => u.lessonId));

    let totalTimeSeconds = 0;
    const unitDetails: UnitDetail[] = units.map((u) => {
      const timeSeconds = timeByCourseLesson.get(`${cid}::${u.lessonId}`) ?? 0;
      totalTimeSeconds += timeSeconds;
      const items = itemsByLesson.get(u.lessonId) ?? [];
      const unitSubs = subsByCourseLesson.get(`${cid}::${u.lessonId}`) ?? [];
      const submissions: SubmissionDetail[] = unitSubs.map((s) => {
        const item = s.assessmentKey ? items.find((i) => i.key === s.assessmentKey) : undefined;
        return {
          assessmentName: s.assessmentKey ? (item?.name ?? 'Assessment') : 'Coursework',
          kind: item?.kind ?? 'assignment',
          documentName: s.files[0]?.name ?? '—',
          documentKey: s.files[0]?.key ?? null,
          submittedAt: s.submittedAt,
          markedAt: s.resultRecordedAt ?? null,
          status: statusOf(s)
        };
      });
      return { lessonId: u.lessonId, unitTitle: u.title ?? 'Untitled unit', timeSeconds, submissions };
    });

    courses.push({
      courseId: cid,
      title: enr.title,
      percent,
      workbooks,
      caseStudies,
      totalTimeSeconds,
      units: unitDetails
    });
  }

  return { learner: { id: learnerId, name: inRoster.name }, courses };
}

/** The learner-facing status of one submission version (mirrors the caseload detail semantics). */
function statusOf(s: SubmissionWithContext): string {
  if (s.resultKind === 'verdict') return isPassingResult(s.result) ? 'Pass' : 'Refer';
  if (s.resultKind === 'draft') return 'Draft feedback';
  return s.submissionType === 'draft' ? 'Awaiting draft feedback' : 'Submitted';
}
