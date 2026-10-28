import type { Actor } from '@cio/db/actor';
import { AppError, ErrorCodes } from '@api/utils/errors';
import { isPassingResult } from '@cio/utils/constants';
import { isCourseTutor, isTutorAllocatedToCourse } from '@cio/db/queries/allocation';
import { visibleLearnerIdsForCourse } from '@api/middlewares/guards/ownership';
import { generateDocumentDownloadPresignedUrls } from '@cio/core/utils/s3';
import {
  getCourseOutline,
  getCourseGridLearners,
  getSubmissionsForAssessment,
  getLatestSubmissionFilesForAssessment,
  getLessonTitle,
  getUnitContent,
  getAssessmentItemsForLesson,
  getSubmissionStatusRowsForLearners,
  type UnitContent,
  type CourseOutline,
  type GridLearner,
  type GridSubmission,
  type CourseworkFile,
  type SubmissionStatusRow
} from '@cio/db/queries/coursework';

// PearlLMS — the TUTOR course-view + submissions-grid services. Self-contained access control: a TUTOR may
// open a course when they are on its team (materials/units) or have allocated learners enrolled in it, but
// they only ever see their OWN allocated learners' data ("Separate groups: <tutor>"); an ADMIN sees all.
// Manager/Learner are refused. Read-only — grading stays on the existing recordResult path.

type RowState = 'not_submitted' | 'draft' | 'draft_feedback' | 'awaiting_marking' | 'referred' | 'passed';

/** Resolve the caller's roster for a course and enforce access. The roster is ALWAYS learner data, so it
 *  follows the central rule (visibleLearnerIdsForCourse): admin = all enrolled, tutor = allocated∩enrolled.
 *  Course ACCESS is wider: a tutor may open the course if they are on its team (materials/units) OR have an
 *  allocated learner on it. A course-team tutor with no allocations gets the content with an EMPTY roster. */
async function resolveRoster(actor: Actor, courseId: string): Promise<{ ids: string[]; isAdmin: boolean }> {
  const ids = await visibleLearnerIdsForCourse(actor, courseId); // 401/403 for non-staff
  if (actor.authenticated && actor.role === 'TUTOR' && ids.length === 0) {
    if (!(await isCourseTutor(actor.userId, courseId))) {
      throw new AppError('You are not assigned to this course', ErrorCodes.FORBIDDEN, 403);
    }
  }
  return { ids, isAdmin: actor.authenticated && actor.role === 'ADMIN' };
}

/**
 * Can this actor OPEN the course (content, units, materials)? Mirrors resolveRoster's access rule EXACTLY, without
 * loading the roster: ADMIN yes; TUTOR yes only if at least one allocated learner is enrolled (STUDENT) in the course
 * (the existence form of "visibleLearnerIdsForCourse is non-empty") OR they are on the course team (isCourseTutor);
 * a tutor with neither gets false. Anyone else throws like visibleLearnerIdsForCourse does (401 unauthenticated,
 * 403 Manager/Learner). Nothing is cached — it reads allocation + team membership fresh on every call.
 */
export async function canAccessCourse(actor: Actor, courseId: string): Promise<boolean> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  if (actor.role === 'ADMIN') return true;
  if (actor.role !== 'TUTOR') throw new AppError('You do not have access to this course', ErrorCodes.FORBIDDEN, 403);
  return (await isTutorAllocatedToCourse(actor.userId, courseId)) || (await isCourseTutor(actor.userId, courseId));
}

/** canAccessCourse as a gate, with resolveRoster's exact 403 for a tutor with no allocated learner and no team seat. */
async function assertCanAccessCourse(actor: Actor, courseId: string): Promise<void> {
  if (!(await canAccessCourse(actor, courseId))) {
    throw new AppError('You are not assigned to this course', ErrorCodes.FORBIDDEN, 403);
  }
}

/** Per-assessment state from a learner's submissions for it (newest first). Mirrors the learner
 *  assignments board so tutor + learner see the same status. Also returns the submission id to grade. */
function computeState(subs: GridSubmission[]): { state: RowState; gradeTargetId: string | null } {
  // gradeTargetId is set ONLY when there's an unmarked latest version to act on now (awaiting final or an
  // unmarked draft). Already-marked states (passed/referred/draft_feedback) → null, so the grid disables
  // "Grade" and a tutor can't trip the no-re-mark 409; the next markable version appears on resubmit.
  if (subs.length === 0) return { state: 'not_submitted', gradeTargetId: null };
  const latestFinal = subs.find((s) => s.submissionType === 'final') ?? null;
  const latestDraft = subs.find((s) => s.submissionType === 'draft') ?? null;
  if (latestFinal) {
    if (latestFinal.resultKind === 'verdict' && isPassingResult(latestFinal.result)) {
      return { state: 'passed', gradeTargetId: null };
    }
    if (latestFinal.resultKind === 'verdict' && latestFinal.result && !isPassingResult(latestFinal.result)) {
      return { state: 'referred', gradeTargetId: null };
    }
    return { state: 'awaiting_marking', gradeTargetId: latestFinal.submissionId }; // unmarked final → grade this
  }
  if (latestDraft && latestDraft.resultKind === 'draft') {
    return { state: 'draft_feedback', gradeTargetId: null };
  }
  return { state: 'draft', gradeTargetId: latestDraft?.submissionId ?? subs[0].submissionId };
}

// ── Phase 1: tutor read-only course content (outline + per-assessment stats) ─────────────────────────

export interface OutlineAssessmentStat {
  key: string;
  name: string;
  kind: string;
  dueAt: string | null;
  submitted: number; // distinct learners with ≥1 submission
  needsGrading: number; // learners whose latest final/draft is unmarked
  passed: number;
}
export interface OutlineMaterial {
  key: string;
  name: string;
  downloadable: boolean;
}
export interface TutorOutlineUnit {
  lessonId: string;
  title: string;
  unitType: string | null;
  isOptional: boolean;
  sectionTitle: string | null;
  materials: OutlineMaterial[];
  assessments: OutlineAssessmentStat[];
}
export interface TutorCourseContent {
  courseId: string;
  title: string;
  participants: number;
  units: TutorOutlineUnit[];
}

export async function getTutorCourseContent(actor: Actor, courseId: string): Promise<TutorCourseContent> {
  const { ids: roster } = await resolveRoster(actor, courseId);
  // Lean rows (no files/comment/feedback) narrowed to THIS course in SQL — the stats below only need per-assessment state.
  const [outline, allSubs] = await Promise.all([
    getCourseOutline(courseId),
    getSubmissionStatusRowsForLearners(roster, { courseId })
  ]);
  if (!outline) throw new AppError('Course not found', ErrorCodes.NOT_FOUND, 404);

  // Group the roster's submissions by (lesson, assessment) → per-learner list (newest first, already sorted).
  const byAssessment = new Map<string, Map<string, SubmissionStatusRow[]>>();
  for (const s of allSubs) {
    const aKey = `${s.lessonId}::${s.assessmentKey ?? ''}`;
    let learners = byAssessment.get(aKey);
    if (!learners) byAssessment.set(aKey, (learners = new Map()));
    const arr = learners.get(s.learnerId);
    if (arr) arr.push(s);
    else learners.set(s.learnerId, [s]);
  }

  const stateOfContext = (subs: SubmissionStatusRow[]): RowState => computeState(subs.map(toGridLike)).state;

  const units: TutorOutlineUnit[] = outline.units.map((u) => {
    const materials: OutlineMaterial[] = [];
    const assessments: OutlineAssessmentStat[] = [];
    for (const d of u.documents) {
      const isAssessment = d.kind === 'workbook' || d.kind === 'casestudy' || d.kind === 'assignment';
      if (!isAssessment) {
        materials.push({ key: d.key, name: d.name, downloadable: d.downloadable });
        continue;
      }
      const learners = byAssessment.get(`${u.lessonId}::${d.key}`) ?? new Map<string, SubmissionStatusRow[]>();
      let submitted = 0;
      let needsGrading = 0;
      let passed = 0;
      for (const subs of learners.values()) {
        submitted++;
        const st = stateOfContext(subs);
        if (st === 'awaiting_marking' || st === 'draft_feedback' || st === 'draft') {
          // draft_feedback already has feedback; only unmarked drafts/finals "need grading"
          if (st === 'awaiting_marking' || st === 'draft') needsGrading++;
        }
        if (st === 'passed') passed++;
      }
      assessments.push({
        key: d.key,
        name: d.name,
        kind: d.kind ?? 'assignment',
        dueAt: d.dueAt,
        submitted,
        needsGrading,
        passed
      });
    }
    return {
      lessonId: u.lessonId,
      title: u.title,
      unitType: u.unitType,
      isOptional: u.isOptional,
      sectionTitle: u.sectionTitle,
      materials,
      assessments
    };
  });

  return { courseId, title: outline.title, participants: roster.length, units };
}

/** Adapt a lean submission row to the minimal GridSubmission shape computeState needs (it reads none of files/feedback). */
function toGridLike(s: SubmissionStatusRow): GridSubmission {
  return {
    submissionId: s.id,
    learnerId: s.learnerId,
    submissionType: s.submissionType,
    version: s.version,
    files: [],
    comment: null,
    status: s.status,
    submittedAt: s.submittedAt,
    resultKind: s.resultKind,
    result: s.result,
    feedback: null,
    feedbackFiles: [],
    recordedAt: s.resultRecordedAt,
    recordedById: null,
    recordedByName: null
  };
}

// ── Tutor per-unit content (read-only) + material downloads ──────────────────────────────────────────

/** The full content of ONE unit for the tutor read-only view. Access-gated (resolveRoster); the
 *  unit must belong to the course in the path (else 404). Read-only — no submit, no edit. */
export async function getTutorUnitContent(actor: Actor, courseId: string, lessonId: string): Promise<UnitContent> {
  await assertCanAccessCourse(actor, courseId); // access gate (403 if neither team nor allocated / not admin) — no roster load
  const content = await getUnitContent(lessonId);
  if (!content || content.courseId !== courseId) {
    throw new AppError('Unit not found in this course', ErrorCodes.NOT_FOUND, 404);
  }
  return content;
}

/**
 * Sign download URLs for a tutor viewing a course's MATERIALS (resources + assessment briefs). Access-
 * gated (course team or allocated), and every requested key must be a real document key on one of THIS course's units (so a tutor can
 * never sign an arbitrary object). Coursework submission files are NOT here — those go through the
 * per-submission coursework download guard.
 */
export async function signCourseMaterialsForTutor(
  actor: Actor,
  courseId: string,
  keys: string[]
): Promise<Record<string, string>> {
  await assertCanAccessCourse(actor, courseId); // access gate — no roster load
  const outline = await getCourseOutline(courseId);
  if (!outline) throw new AppError('Course not found', ErrorCodes.NOT_FOUND, 404);
  const valid = new Set<string>();
  for (const u of outline.units) for (const d of u.documents) valid.add(d.key);
  for (const k of keys) {
    if (!valid.has(k)) {
      throw new AppError('You do not have access to this file', ErrorCodes.FORBIDDEN, 403);
    }
  }
  return generateDocumentDownloadPresignedUrls(keys);
}

// ── Phase 2: the submissions grid for one assessment ─────────────────────────────────────────────────

export interface SubmissionsGridSummary {
  participants: number;
  submitted: number;
  needsGrading: number;
  passed: number;
  referred: number;
  dueAt: string | null;
}
export interface SubmissionsGridRow {
  learner: GridLearner;
  state: RowState;
  latestSubmittedAt: string | null;
  latestSubmissionType: string | null;
  grade: string | null; // latest FINAL verdict result (Pass/Refer)
  feedback: string | null; // latest result feedback (verdict or draft)
  feedbackFiles: CourseworkFile[];
  files: CourseworkFile[]; // latest submission's files
  comment: string | null; // latest submission's learner comment
  lastModifiedGrade: string | null;
  gradedByName: string | null;
  /** The submission id a tutor would grade next (latest unmarked final/draft), or null. */
  gradeTargetId: string | null;
  versionCount: number;
  versions: GridSubmission[]; // full history newest-first (for the expandable detail)
}
export interface SubmissionsGrid {
  courseId: string;
  lessonId: string;
  assessmentKey: string;
  assessmentName: string;
  unitTitle: string;
  kind: string;
  dueAt: string | null;
  allowDrafts: boolean;
  summary: SubmissionsGridSummary;
  rows: SubmissionsGridRow[];
}

export async function getAssessmentSubmissions(
  actor: Actor,
  courseId: string,
  lessonId: string,
  assessmentKey: string
): Promise<SubmissionsGrid> {
  const { ids: roster } = await resolveRoster(actor, courseId);

  const [learners, subs, items, unitTitle] = await Promise.all([
    getCourseGridLearners(courseId, roster),
    getSubmissionsForAssessment(courseId, lessonId, assessmentKey, roster),
    getAssessmentItemsForLesson(lessonId),
    getLessonTitle(lessonId)
  ]);

  const item = items.find((i) => i.key === assessmentKey);
  if (!item) throw new AppError('Assessment not found on this unit', ErrorCodes.NOT_FOUND, 404);

  // Submissions grouped per learner, newest first (query already ordered desc by submittedAt).
  const byLearner = new Map<string, GridSubmission[]>();
  for (const s of subs) {
    const arr = byLearner.get(s.learnerId);
    if (arr) arr.push(s);
    else byLearner.set(s.learnerId, [s]);
  }

  let submitted = 0;
  let needsGrading = 0;
  let passed = 0;
  let referred = 0;

  const rows: SubmissionsGridRow[] = learners
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((learner) => {
      const mySubs = byLearner.get(learner.learnerId) ?? [];
      const { state, gradeTargetId } = computeState(mySubs);
      const latest = mySubs[0] ?? null;
      const latestFinal = mySubs.find((s) => s.submissionType === 'final') ?? null;
      // The result to show (feedback/files): the latest submission that carries a result.
      const resulted = mySubs.find((s) => s.resultKind) ?? null;

      if (mySubs.length > 0) submitted++;
      if (state === 'awaiting_marking' || state === 'draft') needsGrading++;
      if (state === 'passed') passed++;
      if (state === 'referred') referred++;

      return {
        learner,
        state,
        latestSubmittedAt: latest?.submittedAt ?? null,
        latestSubmissionType: latest?.submissionType ?? null,
        grade: latestFinal?.resultKind === 'verdict' ? (latestFinal.result ?? null) : null,
        feedback: resulted?.feedback ?? null,
        feedbackFiles: resulted?.feedbackFiles ?? [],
        files: latest?.files ?? [],
        comment: latest?.comment ?? null,
        lastModifiedGrade: resulted?.recordedAt ?? null,
        gradedByName: resulted?.recordedByName ?? null,
        gradeTargetId,
        versionCount: mySubs.length,
        versions: mySubs
      };
    });

  return {
    courseId,
    lessonId,
    assessmentKey,
    assessmentName: item.name,
    unitTitle: unitTitle ?? 'Untitled unit',
    kind: item.kind,
    dueAt: item.dueAt,
    allowDrafts: item.allowDrafts,
    summary: {
      participants: learners.length,
      submitted,
      needsGrading,
      passed,
      referred,
      dueAt: item.dueAt
    },
    rows
  };
}

export interface AssessmentDownloadLearner {
  learnerId: string;
  name: string;
  files: CourseworkFile[];
}

/**
 * Slim read for "Download all submissions": every in-scope learner's LATEST version's files for one assessment —
 * no grading state, no older versions, no grader joins. The scope is exactly the grid's (resolveRoster ->
 * visibleLearnerIdsForCourse: allocated∩enrolled for a tutor, all enrolled for an admin) and an EMPTY roster is a
 * 404, never "no filter". Only learners still enrolled (present in getCourseGridLearners) are returned, name-sorted.
 */
export async function getAssessmentDownloadFiles(
  actor: Actor,
  courseId: string,
  lessonId: string,
  assessmentKey: string
): Promise<{ assessmentName: string; learners: AssessmentDownloadLearner[] }> {
  const { ids: roster } = await resolveRoster(actor, courseId);
  if (roster.length === 0) {
    throw new AppError('No submitted files to download for this assessment', ErrorCodes.NOT_FOUND, 404);
  }

  const [learners, latest, items] = await Promise.all([
    getCourseGridLearners(courseId, roster),
    getLatestSubmissionFilesForAssessment(courseId, lessonId, assessmentKey, roster),
    getAssessmentItemsForLesson(lessonId)
  ]);

  const item = items.find((i) => i.key === assessmentKey);
  if (!item) throw new AppError('Assessment not found on this unit', ErrorCodes.NOT_FOUND, 404);

  const filesByLearner = new Map(latest.map((r) => [r.learnerId, r.files]));
  return {
    assessmentName: item.name,
    learners: learners
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((l) => ({ learnerId: l.learnerId, name: l.name, files: filesByLearner.get(l.learnerId) ?? [] }))
      .filter((l) => l.files.length > 0)
  };
}
