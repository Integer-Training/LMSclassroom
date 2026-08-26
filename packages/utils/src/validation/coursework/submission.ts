import * as z from 'zod';

import { SUBMISSION_TYPES } from '../../constants/assessment';
import { ZResult } from './result';

/**
 * Validators for learner coursework upload (PearlLMS Phase 3 Step 4). Shape only — the config-driven
 * allow-list (type) and size ceiling are enforced in the service with clear user-facing messages, and
 * key ownership (a learner may only register keys under their own prefix) is enforced server-side from
 * the authenticated actor, never trusted from these inputs.
 */

/** One file the client intends to upload — the presign request. */
const ZPresignFile = z.object({
  fileName: z.string().min(1).max(255),
  fileType: z.string().min(1).max(255),
  fileSize: z.number().int().positive().optional()
});

export const ZCourseworkPresign = z.object({
  // The lesson.documents[].key of the assessment item (workbook/casestudy/assignment) being answered.
  // The service re-validates it is a real assessment material on this lesson.
  assessmentKey: z.string().min(1).max(1024),
  submissionType: z.enum(SUBMISSION_TYPES).default('final'),
  files: z.array(ZPresignFile).min(1).max(10)
});

/** One uploaded file's metadata, recorded on the submission after the PUT completes. */
const ZCourseworkFile = z.object({
  key: z.string().min(1).max(1024),
  name: z.string().min(1).max(255),
  size: z.number().int().nonnegative().optional(),
  type: z.string().max(255).optional()
});

export const ZCourseworkCreate = z.object({
  assessmentKey: z.string().min(1).max(1024),
  submissionType: z.enum(SUBMISSION_TYPES).default('final'),
  version: z.number().int().positive(),
  files: z.array(ZCourseworkFile).min(1).max(10)
});

/** Download-signing request: the keys the caller wants signed URLs for (guard binds each to a submission). */
export const ZCourseworkDownload = z.object({
  keys: z.array(z.string().min(1).max(1024)).min(1).max(20)
});

export const ZSubmissionIdParam = z.object({
  submissionId: z.uuid()
});

/** Path param for the tutor caseload learner-detail route. */
export const ZCaseloadLearnerParam = z.object({
  learnerId: z.uuid()
});

/**
 * Recording a tutor response on a submission version (Step 5 + Phase 8 drafts). Two shapes, disambiguated
 * by the submission's own type in the marking service (which has that context):
 *   - FINAL  → a verdict: `result` (a configured ZResult, PASS/REFER) + optional `feedback`.
 *   - DRAFT  → feedback-only: `result` omitted, `feedback` required (enforced in the service).
 * `result` is therefore optional here; the service rejects a verdict on a draft and a resultless mark on
 * a final. Feedback stays ONE free-text field — no rubric/criteria (tutors assess off-platform).
 */
export const ZMarkSubmission = z.object({
  result: ZResult.optional(),
  feedback: z.string().max(5000).optional()
});
export type MarkSubmissionInput = z.infer<typeof ZMarkSubmission>;

export type CourseworkPresignInput = z.infer<typeof ZCourseworkPresign>;
export type CourseworkCreateInput = z.infer<typeof ZCourseworkCreate>;
