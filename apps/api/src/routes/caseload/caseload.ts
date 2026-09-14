import {
  ZAssessmentKeyQuery,
  ZCaseloadLearnerParam,
  ZCourseIdParam,
  ZCourseLessonParam,
  ZFeedbackPresign,
  ZMarkSubmission,
  ZProgressionQuery,
  ZSubmissionIdParam
} from '@cio/utils/validation/coursework';
import { getCaseloadLearnerDetail, getTutorCaseload, getTutorPipeline } from '@api/services/caseload/caseload';
import { getTutorCourseContent, getAssessmentSubmissions } from '@api/services/caseload/course-view';
import { buildAssessmentSubmissionsZip } from '@api/services/caseload/download-all';
import { getProgression, getProgressionDetail } from '@api/services/progression/progression';
import { recordResult } from '@api/services/coursework/marking';
import { presignFeedbackUploads } from '@api/services/coursework/coursework';

import { Hono } from '@api/utils/hono';
import type { Actor } from '@cio/db/actor';
import { handleError } from '@api/utils/errors';
import { requireStaff } from '@api/middlewares/guards';
import { zValidator } from '@hono/zod-validator';

// Tutor caseload (PearlLMS Phase 3 Step 4) — read-only. requireStaff = ADMIN or TUTOR across the board
// (Manager and Learner denied; Manager gets reports in Phase 5). The roster is allocation-sourced in the
// service, and learner-detail re-checks isAllocatedTutor so a tutor cannot open another tutor's learner
// by id. Mounted at /caseload.
export const caseloadRouter = new Hono()
  .get('/', requireStaff, async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const data = await getTutorCaseload(actor);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load caseload');
    }
  })
  // The grading pipeline — queue lists + headline stats (Phase 8). requireStaff = ADMIN/TUTOR; the
  // service is allocation-scoped (a tutor sees only their learners; Admin sees the org).
  .get('/pipeline', requireStaff, async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const data = await getTutorPipeline(actor);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load grading pipeline');
    }
  })
  // Learner Progression (PearlLMS Phase 9) — the progress table across the caseload. requireStaff =
  // ADMIN/TUTOR; the service is allocation-scoped (Tutor = own roster, Admin = org). Optional ?courseId
  // narrows the table to one course.
  .get('/progression', requireStaff, zValidator('query', ZProgressionQuery), async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const { courseId } = c.req.valid('query');
      const data = await getProgression(actor, courseId);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load progression');
    }
  })
  // One learner's full progression detail. requireStaff + the learner must be in the caller's roster
  // (else 403 — the URL-tamper defence, mirroring the caseload learner-detail rule).
  .get('/progression/:learnerId', requireStaff, zValidator('param', ZCaseloadLearnerParam), async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const { learnerId } = c.req.valid('param');
      const data = await getProgressionDetail(actor, learnerId);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load learner progression');
    }
  })
  .get('/learners/:learnerId', requireStaff, zValidator('param', ZCaseloadLearnerParam), async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const { learnerId } = c.req.valid('param');
      const data = await getCaseloadLearnerDetail(actor, learnerId);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load learner');
    }
  })
  // Record a result + feedback on a submission version (Step 5). requireStaff gates ADMIN/TUTOR at the
  // route; recordResult additionally requires an ALLOCATED tutor (or Admin) and enforces latest-only /
  // no-re-mark. Manager and Learner are denied.
  .post(
    '/submissions/:submissionId/result',
    requireStaff,
    zValidator('param', ZSubmissionIdParam),
    zValidator('json', ZMarkSubmission),
    async (c) => {
      try {
        const actor = c.get('actor') as Actor;
        const { submissionId } = c.req.valid('param');
        const { result, feedback, feedbackFiles } = c.req.valid('json');
        const data = await recordResult(actor, submissionId, { result, feedback, feedbackFiles });
        return c.json({ success: true, data }, 201);
      } catch (error) {
        return handleError(c, error, 'Failed to record result');
      }
    }
  )
  // Presign feedback-file uploads for a submission (tutor attaches the learner's workbook marked up).
  // requireStaff at the door; presignFeedbackUploads additionally requires ADMIN or the ALLOCATED tutor.
  .post(
    '/submissions/:submissionId/feedback/presign',
    requireStaff,
    zValidator('param', ZSubmissionIdParam),
    zValidator('json', ZFeedbackPresign),
    async (c) => {
      try {
        const actor = c.get('actor') as Actor;
        const { submissionId } = c.req.valid('param');
        const { files } = c.req.valid('json');
        const data = await presignFeedbackUploads(actor, submissionId, files);
        return c.json({ success: true, data }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to prepare feedback upload');
      }
    }
  )
  // Tutor read-only course content — outline of units, materials + assessments with per-workbook stats.
  // requireStaff at the door; the service allows only an ADMIN or a tutor allocated to the course.
  .get('/courses/:courseId/content', requireStaff, zValidator('param', ZCourseIdParam), async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const { courseId } = c.req.valid('param');
      const data = await getTutorCourseContent(actor, courseId);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load course content');
    }
  })
  // The submissions grid for one assessment (workbook) on a unit — every roster learner's submission +
  // grading summary. requireStaff at the door; service scopes to allocated∩enrolled (tutor) / all (admin).
  .get(
    '/courses/:courseId/lessons/:lessonId/submissions',
    requireStaff,
    zValidator('param', ZCourseLessonParam),
    zValidator('query', ZAssessmentKeyQuery),
    async (c) => {
      try {
        const actor = c.get('actor') as Actor;
        const { courseId, lessonId } = c.req.valid('param');
        const { assessmentKey } = c.req.valid('query');
        const data = await getAssessmentSubmissions(actor, courseId, lessonId, assessmentKey);
        return c.json({ success: true, data }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to load submissions');
      }
    }
  )
  // "Download all submissions" — a zip of every roster learner's latest files for one workbook. Same
  // access scope as the grid (reuses getAssessmentSubmissions inside the zip builder).
  .get(
    '/courses/:courseId/lessons/:lessonId/submissions/download-all',
    requireStaff,
    zValidator('param', ZCourseLessonParam),
    zValidator('query', ZAssessmentKeyQuery),
    async (c) => {
      try {
        const actor = c.get('actor') as Actor;
        const { courseId, lessonId } = c.req.valid('param');
        const { assessmentKey } = c.req.valid('query');
        const { filename, buffer } = await buildAssessmentSubmissionsZip(actor, courseId, lessonId, assessmentKey);
        c.header('Content-Type', 'application/zip');
        c.header('Content-Disposition', `attachment; filename="${filename}"`);
        return c.body(buffer as unknown as ArrayBuffer);
      } catch (error) {
        return handleError(c, error, 'Failed to build submissions zip');
      }
    }
  );
