import type { Actor } from '@cio/db/actor';
import { AppError, ErrorCodes } from '@api/utils/errors';
import { isPassingResult } from '@cio/utils/constants';
import { getEnrolmentsForLearners } from '@cio/db/queries/caseload';
import { getOrderedUnitsForCourse } from '@cio/db/queries/gating';
import {
  getAssessmentItemsByLesson,
  getSubmissionsWithContextForLearners,
  type SubmissionWithContext
} from '@cio/db/queries/coursework';
import { getCourseUnlockMap } from '@api/services/gating/unlock';

// PearlLMS — the LEARNER-SELF assessment aggregate (the Phase-8 "B5" learner dashboard, self-scoped).
// Lists every workbook / case study / assignment across the caller's OWN enrolled courses, with the same
// per-item state the lesson card computes (so nothing disagrees), each item's due date and — under
// sequential unlock — whether its unit is still locked. Reuses the exact queries the tutor progression
// service uses, but keyed on the caller's own id only (no roster, no cross-learner reach).

export type AssignmentState =
  | 'not_started'
  | 'draft' // a draft submitted, awaiting tutor draft-feedback
  | 'draft_feedback' // tutor left draft feedback; learner should now submit the final
  | 'awaiting_marking' // final submitted, no verdict yet
  | 'referred' // latest final was Refer — resubmit
  | 'passed'; // latest final passed

export interface LearnerAssignment {
  courseId: string;
  courseTitle: string;
  lessonId: string;
  unitTitle: string;
  /** null for legacy unit-level coursework (pre-Phase-8, no tagged assessment). */
  assessmentKey: string | null;
  name: string;
  /** workbook | casestudy | assignment | coursework (legacy fallback). */
  kind: string;
  dueAt: string | null;
  state: AssignmentState;
  /** Under sequential unlock, true when the unit's gate hasn't been passed yet. */
  locked: boolean;
  lockedByTitle: string | null;
  latestVersion: number | null;
  latestSubmittedAt: string | null;
  markedAt: string | null;
  /** Raw result value (Pass/Refer) when a verdict exists, else null. */
  result: string | null;
  /** Tutor feedback relevant to the current state (verdict feedback, or draft feedback), else null. */
  feedback: string | null;
}

export interface LearnerAssignmentsList {
  courses: { courseId: string; title: string }[];
  items: LearnerAssignment[];
}

interface ItemState {
  state: AssignmentState;
  result: string | null;
  feedback: string | null;
  markedAt: string | null;
  latestVersion: number | null;
  latestSubmittedAt: string | null;
}

/**
 * The learner-facing state of ONE assessment from its submission group (newest first — the submittedAt-DESC
 * order getSubmissionsWithContextForLearners returns; version rises with submittedAt so this is the latest). Mirrors coursework-submission.svelte: passed/referred are
 * read off the NEWEST FINAL; a final without a verdict is awaiting-marking; with only drafts, a draft that
 * carries draft-feedback is "feedback ready", otherwise it's an in-progress draft.
 */
function computeItemState(subs: SubmissionWithContext[]): ItemState {
  if (subs.length === 0) {
    return { state: 'not_started', result: null, feedback: null, markedAt: null, latestVersion: null, latestSubmittedAt: null };
  }
  const latest = subs[0];
  const latestFinal = subs.find((s) => s.submissionType === 'final') ?? null;
  const latestDraft = subs.find((s) => s.submissionType === 'draft') ?? null;

  if (latestFinal) {
    const isVerdict = latestFinal.resultKind === 'verdict';
    if (isVerdict && isPassingResult(latestFinal.result)) {
      return { state: 'passed', result: latestFinal.result, feedback: latestFinal.feedback, markedAt: latestFinal.resultRecordedAt, latestVersion: latestFinal.version, latestSubmittedAt: latestFinal.submittedAt };
    }
    if (isVerdict && latestFinal.result && !isPassingResult(latestFinal.result)) {
      return { state: 'referred', result: latestFinal.result, feedback: latestFinal.feedback, markedAt: latestFinal.resultRecordedAt, latestVersion: latestFinal.version, latestSubmittedAt: latestFinal.submittedAt };
    }
    // A final exists but isn't a verdict yet → awaiting marking.
    return { state: 'awaiting_marking', result: null, feedback: null, markedAt: null, latestVersion: latestFinal.version, latestSubmittedAt: latestFinal.submittedAt };
  }

  // Only drafts so far.
  if (latestDraft && latestDraft.resultKind === 'draft') {
    return { state: 'draft_feedback', result: null, feedback: latestDraft.feedback, markedAt: latestDraft.resultRecordedAt, latestVersion: latestDraft.version, latestSubmittedAt: latestDraft.submittedAt };
  }
  return { state: 'draft', result: null, feedback: null, markedAt: null, latestVersion: latest.version, latestSubmittedAt: latest.submittedAt };
}

/**
 * Every assessment the caller has across their own enrolled courses. Self-scoped: the learner id is the
 * authenticated caller's, never a param, so there is no way to read another learner's work. Locked units
 * are INCLUDED (with `locked: true`) so the learner sees the whole roadmap; the actual content/upload
 * guards still block acting on a locked unit server-side.
 */
export async function getLearnerAssignments(actor: Actor): Promise<LearnerAssignmentsList> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  const learnerId = actor.userId;

  const [enrolments, subs] = await Promise.all([
    getEnrolmentsForLearners([learnerId]),
    getSubmissionsWithContextForLearners([learnerId])
  ]);

  // Distinct enrolled courses, first-seen order (the filter list + the courses we walk).
  const courseMap = new Map<string, string>();
  for (const e of enrolments) if (!courseMap.has(e.courseId)) courseMap.set(e.courseId, e.title);

  // Submissions grouped by (course, lesson, assessmentKey) — newest-first order preserved. Legacy
  // unit-level rows have a null key, stored under the '' bucket.
  const groupKey = (courseId: string, lessonId: string, key: string | null) => `${courseId}::${lessonId}::${key ?? ''}`;
  const subsByItem = new Map<string, SubmissionWithContext[]>();
  const keysByCourseLesson = new Map<string, Set<string>>();
  for (const s of subs) {
    const gk = groupKey(s.courseId, s.lessonId, s.assessmentKey);
    const arr = subsByItem.get(gk);
    if (arr) arr.push(s);
    else subsByItem.set(gk, [s]);
    const clk = `${s.courseId}::${s.lessonId}`;
    const set = keysByCourseLesson.get(clk) ?? new Set<string>();
    set.add(s.assessmentKey ?? '');
    keysByCourseLesson.set(clk, set);
  }

  // Every (course,lesson,key) group we've represented as an item — the sweep below catches anything left.
  const emitted = new Set<string>();

  // Build each enrolled course's items concurrently (a learner has few courses; passedCache in the unlock
  // map dedupes gate checks), then flatten preserving course order.
  const perCourse = await Promise.all(
    [...courseMap].map(async ([courseId, title]) => {
      const out: LearnerAssignment[] = [];
      const units = await getOrderedUnitsForCourse(courseId);
      const [itemsByLesson, unlockMap] = await Promise.all([
        getAssessmentItemsByLesson(units.map((u) => u.lessonId)),
        getCourseUnlockMap(actor, courseId)
      ]);

      for (const u of units) {
        const lock = unlockMap[u.lessonId] ?? { unlocked: true, lockedByTitle: null };
        const unitTitle = u.title ?? 'Untitled unit';
        const tagged = itemsByLesson.get(u.lessonId) ?? [];
        const matchedKeys = new Set<string>();

        for (const item of tagged) {
          matchedKeys.add(item.key);
          const gk = groupKey(courseId, u.lessonId, item.key);
          emitted.add(gk);
          const st = computeItemState(subsByItem.get(gk) ?? []);
          // Only a NOT-yet-started item can read as locked: if the learner already submitted (any state),
          // the unit was open to them, so its real state drives the card — never a stale "locked" badge
          // (e.g. a unit whose gate was toggled on after submission). This makes locked ⟹ not_started.
          const locked = st.state === 'not_started' && !lock.unlocked;
          out.push({
            courseId,
            courseTitle: title,
            lessonId: u.lessonId,
            unitTitle,
            assessmentKey: item.key,
            name: item.name,
            kind: item.kind,
            dueAt: item.dueAt,
            state: st.state,
            locked,
            lockedByTitle: locked ? lock.lockedByTitle : null,
            latestVersion: st.latestVersion,
            latestSubmittedAt: st.latestSubmittedAt,
            markedAt: st.markedAt,
            result: st.result,
            feedback: st.feedback
          });
        }

        // Legacy / orphan fallback: any submissions in this unit not matching a tagged item (null key =
        // pre-Phase-8 unit-level coursework, or a key whose tagged document was later removed). Surface
        // them so a learner's own submitted work never silently disappears from this view. Guarding on
        // matchedKeys alone (not `pk !== ''`) also blocks a degenerate empty-string tagged key from
        // double-listing against the null-key synthetic item.
        for (const pk of keysByCourseLesson.get(`${courseId}::${u.lessonId}`) ?? []) {
          if (matchedKeys.has(pk)) continue;
          const gk = `${courseId}::${u.lessonId}::${pk}`;
          const group = subsByItem.get(gk) ?? [];
          if (group.length === 0) continue;
          emitted.add(gk);
          const st = computeItemState(group);
          out.push({
            courseId,
            courseTitle: title,
            lessonId: u.lessonId,
            unitTitle,
            assessmentKey: pk === '' ? null : pk,
            name: 'Coursework',
            kind: 'coursework',
            dueAt: null,
            state: st.state,
            // A synthetic item exists only because a submission exists → the unit was open → never locked.
            locked: false,
            lockedByTitle: null,
            latestVersion: st.latestVersion,
            latestSubmittedAt: st.latestSubmittedAt,
            markedAt: st.markedAt,
            result: st.result,
            feedback: st.feedback
          });
        }
      }
      return out;
    })
  );

  const items = perCourse.flat();

  // Safety net: a submission whose lesson isn't in its course's ordered units (a removed/orphaned lesson)
  // would otherwise be dropped by the unit walk above. Surface any such OWN submission in an enrolled
  // course using the course/unit titles the submission itself carries, so no submitted work disappears.
  for (const [gk, group] of subsByItem) {
    if (emitted.has(gk)) continue;
    const s = group[0];
    if (!courseMap.has(s.courseId)) continue; // not an enrolled course → out of scope for this board
    const st = computeItemState(group);
    items.push({
      courseId: s.courseId,
      courseTitle: courseMap.get(s.courseId) ?? s.courseTitle,
      lessonId: s.lessonId,
      unitTitle: s.unitTitle,
      assessmentKey: s.assessmentKey,
      name: 'Coursework',
      kind: 'coursework',
      dueAt: null,
      state: st.state,
      locked: false,
      lockedByTitle: null,
      latestVersion: st.latestVersion,
      latestSubmittedAt: st.latestSubmittedAt,
      markedAt: st.markedAt,
      result: st.result,
      feedback: st.feedback
    });
  }

  return { courses: [...courseMap].map(([courseId, t]) => ({ courseId, title: t })), items };
}
