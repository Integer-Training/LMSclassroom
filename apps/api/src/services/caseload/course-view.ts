import type { Actor } from '@cio/db/actor';
import { AppError, ErrorCodes } from '@api/utils/errors';
import { isPassingResult } from '@cio/utils/constants';
import { isTutorAllocatedToCourse, listAllocatedLearnerIdsForCourse } from '@cio/db/queries/allocation';
import { listEnrolledLearnersWithName } from '@cio/db/queries/reports';
import {
  getCourseOutline,
  getCourseGridLearners,
  getSubmissionsForAssessment,
  getLessonTitle,
  getAssessmentItemsForLesson,
  getSubmissionsWithContextForLearners,
  type CourseOutline,
  type GridLearner,
  type GridSubmission,
  type CourseworkFile,
  type SubmissionWithContext
} from '@cio/db/queries/coursework';

// PearlLMS — the TUTOR course-view + submissions-grid services. Self-contained access control: a TUTOR may
// see a course only when they have allocated learners enrolled in it (isTutorAllocatedToCourse), and only
// their OWN allocated learners' submissions ("Separate groups: <tutor>"); an ADMIN sees all enrolled.
// Manager/Learner are refused. Read-only — grading stays on the existing recordResult path.

type RowState = 'not_submitted' | 'draft' | 'draft_feedback' | 'awaiting_marking' | 'referred' | 'passed';

/** Resolve the caller's roster for a course (allocated∩enrolled for a tutor, all-enrolled for admin) and
 *  enforce access. Empty tutor roster = not allocated to this course = 403. */
async function resolveRoster(actor: Actor, courseId: string): Promise<{ ids: string[]; isAdmin: boolean }> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  if (actor.role === 'ADMIN') {
    const enrolled = await listEnrolledLearnersWithName(courseId);
    return { ids: enrolled.map((l) => l.learnerId), isAdmin: true };
  }
  if (actor.role === 'TUTOR') {
    const ids = await listAllocatedLearnerIdsForCourse(actor.userId, courseId);
    if (ids.length === 0) throw new AppError('You are not assigned to this course', ErrorCodes.FORBIDDEN, 403);
    return { ids, isAdmin: false };
  }
  throw new AppError('You do not have access to this course', ErrorCodes.FORBIDDEN, 403);
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
  const [outline, allSubs] = await Promise.all([
    getCourseOutline(courseId),
    getSubmissionsWithContextForLearners(roster)
  ]);
  if (!outline) throw new AppError('Course not found', ErrorCodes.NOT_FOUND, 404);

  // Group the roster's submissions by (lesson, assessment) → per-learner list (newest first, already sorted).
  const byAssessment = new Map<string, Map<string, SubmissionWithContext[]>>();
  for (const s of allSubs) {
    const aKey = `${s.lessonId}::${s.assessmentKey ?? ''}`;
    let learners = byAssessment.get(aKey);
    if (!learners) byAssessment.set(aKey, (learners = new Map()));
    const arr = learners.get(s.learnerId);
    if (arr) arr.push(s);
    else learners.set(s.learnerId, [s]);
  }

  const stateOfContext = (subs: SubmissionWithContext[]): RowState =>
    computeState(subs.map(toGridLike)).state;

  const units: TutorOutlineUnit[] = outline.units.map((u) => {
    const materials: OutlineMaterial[] = [];
    const assessments: OutlineAssessmentStat[] = [];
    for (const d of u.documents) {
      const isAssessment = d.kind === 'workbook' || d.kind === 'casestudy' || d.kind === 'assignment';
      if (!isAssessment) {
        materials.push({ key: d.key, name: d.name, downloadable: d.downloadable });
        continue;
      }
      const learners = byAssessment.get(`${u.lessonId}::${d.key}`) ?? new Map<string, SubmissionWithContext[]>();
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
      sectionTitle: u.sectionTitle,
      materials,
      assessments
    };
  });

  return { courseId, title: outline.title, participants: roster.length, units };
}

/** Adapt a SubmissionWithContext to the minimal GridSubmission shape computeState needs. */
function toGridLike(s: SubmissionWithContext): GridSubmission {
  return {
    submissionId: s.id,
    learnerId: s.learnerId,
    submissionType: s.submissionType,
    version: s.version,
    files: s.files,
    comment: null,
    status: s.status,
    submittedAt: s.submittedAt,
    resultKind: s.resultKind,
    result: s.result,
    feedback: s.feedback,
    feedbackFiles: [],
    recordedAt: s.resultRecordedAt,
    recordedById: null,
    recordedByName: null
  };
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
