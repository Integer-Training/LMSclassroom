import { classroomio } from '$lib/utils/services/api';
import { BaseApi } from '$lib/utils/services/api/base.svelte';
import { snackbar } from '$features/ui/snackbar/store';
import { courseworkApi } from '$features/course/api/coursework.svelte';

export interface CaseloadState {
  key: string;
  label: string;
  awaitingMarking: boolean;
}
export interface CaseloadUnit {
  lessonId: string;
  title: string;
  latestVersion: number;
  submissionCount: number;
  submittedAt: string;
  state: CaseloadState;
}
export interface CaseloadCourse {
  courseId: string;
  title: string;
  units: CaseloadUnit[];
}
export interface CaseloadLearner {
  learnerId: string;
  name: string | null;
  email: string | null;
  courses: CaseloadCourse[];
  submissionCount: number;
}
export interface AwaitingItem {
  submissionId: string;
  learnerId: string;
  learnerName: string | null;
  courseId: string;
  courseTitle: string;
  lessonId: string;
  unitTitle: string;
  version: number;
  submittedAt: string;
}

export interface DetailFile {
  key: string;
  name: string;
  size?: number;
  type?: string;
}
export interface DetailSubmission {
  id: string;
  version: number;
  submittedAt: string;
  status: string;
  assessmentKey: string | null;
  assessmentName: string;
  submissionType: string;
  resultKind: string | null;
  result: string | null;
  feedback: string | null;
  files: DetailFile[];
}
export interface DetailUnit {
  lessonId: string;
  title: string;
  state: CaseloadState;
  submissions: DetailSubmission[];
}
export interface DetailCourse {
  courseId: string;
  title: string;
  units: DetailUnit[];
}
export interface LearnerDetail {
  learner: { id: string; name: string | null; email: string | null };
  courses: DetailCourse[];
}

// PearlLMS Phase 9 — Learner Progression (progress table + per-learner detail), from GET /caseload/progression.
export type ActivityStatus = 'created' | 'active' | 'inactive';
export interface KindCount {
  passed: number;
  total: number;
}
export interface ProgressionRow {
  learnerId: string;
  name: string | null;
  startDate: string | null;
  activity: ActivityStatus;
  currentPercent: number;
  currentUnitIndex: number | null;
  workbooks: KindCount;
  caseStudies: KindCount;
}
export interface ProgressionCourse {
  courseId: string;
  title: string;
}
export interface ProgressionList {
  courses: ProgressionCourse[];
  rows: ProgressionRow[];
}
export interface ProgressionSubmissionDetail {
  assessmentName: string;
  kind: string;
  documentName: string;
  documentKey: string | null;
  submittedAt: string;
  markedAt: string | null;
  status: string;
}
export interface ProgressionUnitDetail {
  lessonId: string;
  unitTitle: string;
  timeSeconds: number;
  submissions: ProgressionSubmissionDetail[];
}
export interface ProgressionCourseDetail {
  courseId: string;
  title: string;
  percent: number;
  workbooks: KindCount;
  caseStudies: KindCount;
  totalTimeSeconds: number;
  units: ProgressionUnitDetail[];
}
export interface ProgressionDetail {
  learner: { id: string; name: string | null };
  courses: ProgressionCourseDetail[];
}

// PearlLMS Phase 8 — the tutor grading pipeline (queues + stats), from GET /caseload/pipeline.
export interface PipelineItem {
  submissionId: string;
  learnerId: string;
  learnerName: string | null;
  courseId: string;
  courseTitle: string;
  lessonId: string;
  unitTitle: string;
  assessmentKey: string | null;
  assessmentName: string;
  submissionType: string;
  version: number;
  submittedAt: string;
  dueAt: string | null;
}
export interface TutorPipelineStats {
  learners: number;
  activeLearners: number;
  inactiveLearners: number;
  neverLoggedIn: number;
  suspendedLearners: number;
  learnersWithPendingWork: number;
  courses: number;
  assignments: number;
  awaitingMarking: number;
  resubmissions: number;
  awaitingDraftFeedback: number;
  overdue: number;
  dueSoon: number;
  totalGraded: number;
  passCount: number;
  referCount: number;
  avgTurnaroundDays: number | null;
}
export interface ProgrammeRow {
  courseId: string;
  title: string;
  learners: number;
}
export interface TutorPipeline {
  stats: TutorPipelineStats;
  awaitingMarking: PipelineItem[];
  resubmissions: PipelineItem[];
  awaitingDraftFeedback: PipelineItem[];
  overdue: PipelineItem[];
  dueSoon: PipelineItem[];
  programmes: ProgrammeRow[];
}

/**
 * Tutor caseload (PearlLMS Phase 3 Step 4). Read-only review of allocated learners' coursework — the
 * roster and every learner are enforced allocated-only server-side (requireStaff + isAllocatedTutor);
 * this client just drives the UI. File opens go through the shared guarded coursework download endpoint.
 */
class CaseloadApi extends BaseApi {
  learners = $state<CaseloadLearner[]>([]);
  awaiting = $state<AwaitingItem[]>([]);
  detail = $state<LearnerDetail | null>(null);
  pipeline = $state<TutorPipeline | null>(null);
  // Learner Progression (Phase 9): the table + a per-learner detail cache (expandable rows).
  progression = $state<ProgressionList | null>(null);
  progressionDetail = $state<Record<string, ProgressionDetail>>({});
  progressionDetailLoading = $state<Record<string, boolean>>({});

  /** The grading pipeline — queue lists + headline stats (Phase 8). Allocation-scoped server-side. */
  async loadPipeline() {
    return this.execute<typeof classroomio.caseload.pipeline.$get>({
      requestFn: () => classroomio.caseload.pipeline.$get(),
      logContext: 'loading grading pipeline',
      onSuccess: (result) => {
        this.pipeline = result.data as TutorPipeline;
      },
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
      }
    });
  }

  /** The progression table (Phase 9). Optional courseId narrows it to one course (server re-fetch). */
  async loadProgression(courseId?: string) {
    return this.execute<typeof classroomio.caseload.progression.$get>({
      requestFn: () => classroomio.caseload.progression.$get({ query: courseId ? { courseId } : {} }),
      logContext: 'loading progression',
      onSuccess: (result) => {
        this.progression = result.data as ProgressionList;
      },
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
      }
    });
  }

  /** One learner's progression detail (expandable row). Cached per learner; re-fetches on demand. */
  async loadProgressionDetail(learnerId: string) {
    this.progressionDetailLoading = { ...this.progressionDetailLoading, [learnerId]: true };
    const res = await this.execute<(typeof classroomio.caseload.progression)[':learnerId']['$get']>({
      requestFn: () => classroomio.caseload.progression[':learnerId'].$get({ param: { learnerId } }),
      logContext: 'loading learner progression detail',
      onSuccess: (result) => {
        this.progressionDetail = { ...this.progressionDetail, [learnerId]: result.data as ProgressionDetail };
      },
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
      }
    });
    this.progressionDetailLoading = { ...this.progressionDetailLoading, [learnerId]: false };
    return res;
  }

  async loadCaseload() {
    return this.execute<typeof classroomio.caseload.$get>({
      requestFn: () => classroomio.caseload.$get(),
      logContext: 'loading caseload',
      onSuccess: (result) => {
        this.learners = result.data.learners as CaseloadLearner[];
        this.awaiting = result.data.awaiting as AwaitingItem[];
      },
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
      }
    });
  }

  async loadLearner(learnerId: string) {
    this.detail = null;
    return this.execute<(typeof classroomio.caseload.learners)[':learnerId']['$get']>({
      requestFn: () => classroomio.caseload.learners[':learnerId'].$get({ param: { learnerId } }),
      logContext: 'loading learner detail',
      onSuccess: (result) => {
        this.detail = result.data as LearnerDetail;
      },
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
      }
    });
  }

  /**
   * Record a tutor response on a submission version (allocated tutor / Admin). A FINAL takes a verdict
   * (result = Pass/Refer); a DRAFT takes feedback only (result undefined). Returns true on success.
   */
  async markResult(submissionId: string, result: string | undefined, feedback: string): Promise<boolean> {
    const res = await this.execute<(typeof classroomio.caseload.submissions)[':submissionId']['result']['$post']>({
      requestFn: () =>
        classroomio.caseload.submissions[':submissionId'].result.$post({
          param: { submissionId },
          json: { result, feedback: feedback.trim() ? feedback.trim() : undefined }
        }),
      logContext: 'recording result',
      onSuccess: () => snackbar.success(result ? 'Result recorded' : 'Draft feedback sent'),
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
        else if ('error' in result && typeof result.error === 'string') snackbar.error(result.error);
      }
    });
    return !!res;
  }

  /** Open one coursework file via the shared guarded download endpoint (allocated tutor / Admin only). */
  openFile(courseId: string, lessonId: string, key: string) {
    return courseworkApi.openFile(courseId, lessonId, key);
  }
}

export const caseloadApi = new CaseloadApi();
