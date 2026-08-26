import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { AUDIT_ACTIONS, recordAudit } from '@cio/db/audit';
import { ALLOWED_DOCUMENT_TYPES } from '@cio/utils/validation/constants';
import { isUniqueConstraintViolation } from '@cio/utils/errors';
import { getUploadLimits } from '@cio/core/config/upload-limits';
import { courseworkKeyPrefix, generateCourseworkFileKey } from '@cio/core/utils/upload';
import { generateDocumentDownloadPresignedUrls, generateDocumentUploadPresignedUrl } from '@cio/core/utils/s3';
import {
  createSubmission,
  getAssessmentItemsForLesson,
  getNextSubmissionVersion,
  getSubmissionById,
  hasLearnerPassedUnit,
  isAssessmentUploadClosed,
  listSubmissionsWithResultForLearnerUnit,
  type AssessmentItem,
  type CourseworkFile,
  type CourseworkSubmissionRow,
  type SubmissionWithResultRow
} from '@cio/db/queries/coursework';
import { canReadCoursework } from '@api/middlewares/guards';
import { notifyCourseworkSubmitted } from '@api/services/coursework/notifications';

/**
 * Resolve + validate the assessment item a submission targets. The key must be a REAL assessment material
 * (tagged workbook/casestudy/assignment) on THIS unit — never trusted from input. A draft against an item
 * with drafts disabled, or a submit against an already-passed item, is rejected here (the guard can't see
 * the body, so these body-dependent checks live in the service). Returns the item's config (allowDrafts etc.).
 */
async function resolveSubmittableAssessment(
  learnerId: string,
  lessonId: string,
  assessmentKey: string,
  submissionType: string
): Promise<AssessmentItem> {
  const item = (await getAssessmentItemsForLesson(lessonId)).find((i) => i.key === assessmentKey);
  if (!item) {
    throw new AppError('This is not a submittable assessment on this unit', ErrorCodes.VALIDATION_ERROR, 400);
  }
  if (submissionType === 'draft' && !item.allowDrafts) {
    throw new AppError('Drafts are not enabled for this assessment', ErrorCodes.VALIDATION_ERROR, 400);
  }
  if (await isAssessmentUploadClosed(learnerId, lessonId, assessmentKey)) {
    throw new AppError('You have passed this assessment — no further submissions are needed', ErrorCodes.FORBIDDEN, 403);
  }
  return item;
}

// Learner coursework upload (PearlLMS Phase 3 Step 4). Uploads follow the Phase-2 guarded-storage
// pattern: the server issues presigned PUT URLs under the learner's own coursework prefix, the client
// PUTs bytes straight to the private bucket, then registers the resulting keys as a versioned
// submission. Every read/download is re-guarded — a key alone never grants access.

const ALLOWED_TYPES = new Set<string>(ALLOWED_DOCUMENT_TYPES);
const ALLOWED_TYPES_LABEL = 'PDF or Word (.doc, .docx)';

/** Clear, user-facing type check against the config allow-list. */
function assertAllowedType(fileType: string, fileName: string): void {
  if (!ALLOWED_TYPES.has(fileType)) {
    throw new AppError(
      `"${fileName}" is not an accepted file type. Please upload ${ALLOWED_TYPES_LABEL}.`,
      ErrorCodes.VALIDATION_ERROR,
      400
    );
  }
}

/** Clear, user-facing size check against the config document ceiling (advisory — bucket policy is the ceiling). */
function assertWithinSize(fileSize: number | undefined, fileName: string, maxBytes: number): void {
  if (fileSize != null && fileSize > maxBytes) {
    const mb = Math.round(maxBytes / 1024 / 1024);
    throw new AppError(`"${fileName}" is too large. The maximum file size is ${mb}MB.`, 'FILE_TOO_LARGE', 413);
  }
}

export interface PresignedCourseworkFile {
  fileName: string;
  fileKey: string;
  uploadUrl: string;
}

/**
 * Issue presigned upload URLs for a coursework submission. Validates type + size FIRST (clear errors),
 * computes the next version for this learner+unit, and bakes the learner-scoped key for each file. The
 * learner id is the authenticated actor's own — never taken from input — so keys are always under the
 * caller's own prefix.
 */
export async function presignCourseworkUploads(
  actor: Actor,
  courseId: string,
  lessonId: string,
  assessmentKey: string,
  submissionType: string,
  files: Array<{ fileName: string; fileType: string; fileSize?: number }>
): Promise<{ version: number; files: PresignedCourseworkFile[] }> {
  if (!actor.authenticated) {
    throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  }
  await resolveSubmittableAssessment(actor.userId, lessonId, assessmentKey, submissionType);

  const limits = getUploadLimits();
  for (const f of files) {
    assertAllowedType(f.fileType, f.fileName);
    assertWithinSize(f.fileSize, f.fileName, limits.documentBytes);
  }

  const version = await getNextSubmissionVersion(actor.userId, lessonId, assessmentKey);
  const out: PresignedCourseworkFile[] = [];
  for (const f of files) {
    const fileKey = generateCourseworkFileKey(courseId, actor.userId, lessonId, assessmentKey, version, f.fileName);
    const uploadUrl = await generateDocumentUploadPresignedUrl(fileKey, f.fileType);
    out.push({ fileName: f.fileName, fileKey, uploadUrl });
  }
  return { version, files: out };
}

/**
 * Record a versioned submission after the client has PUT its files. Security lynchpin: every submitted
 * key MUST live under this learner's own prefix for this course/unit/version — reconstructed from the
 * authenticated actor + path, so a learner can never register another learner's key or an arbitrary
 * object. A version collision (concurrent submit) surfaces as 409. Audits coursework.submitted with ids
 * + counts only (never file names or contents).
 */
export async function createCourseworkSubmission(
  actor: Actor,
  courseId: string,
  lessonId: string,
  assessmentKey: string,
  submissionType: string,
  version: number,
  files: CourseworkFile[]
): Promise<CourseworkSubmissionRow> {
  if (!actor.authenticated) {
    throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  }
  await resolveSubmittableAssessment(actor.userId, lessonId, assessmentKey, submissionType);

  const expectedPrefix = courseworkKeyPrefix(courseId, actor.userId, lessonId, assessmentKey, version);
  for (const f of files) {
    if (!f.key.startsWith(expectedPrefix)) {
      throw new AppError('Invalid file reference for this submission', ErrorCodes.VALIDATION_ERROR, 400);
    }
    if (f.type) assertAllowedType(f.type, f.name);
  }

  let row: CourseworkSubmissionRow;
  try {
    row = await createSubmission({ learnerId: actor.userId, courseId, lessonId, assessmentKey, submissionType, version, files });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new AppError('This version already exists — please retry your upload', ErrorCodes.CONFLICT, 409);
    }
    throw error;
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.COURSEWORK_SUBMITTED,
    entityType: 'coursework_submission',
    entityId: row.id,
    metadata: { courseId, lessonId, assessmentKey, submissionType, version, fileCount: files.length } // ids + counts only
  });

  // Notify the learner's allocated tutor(s) — fire-and-forget: a mail failure must never roll back the
  // submission that was just recorded.
  try {
    await notifyCourseworkSubmitted({ learnerId: actor.userId, courseId, lessonId });
  } catch (error) {
    console.error('[coursework] submission notification failed (submission still recorded):', error);
  }

  return row;
}

/**
 * The CALLER'S OWN submissions for a unit — newest version first, each with its result + feedback
 * (Step 5) — plus `canSubmit` (false once the unit is passed, so the UI closes the uploader). Self-
 * scoped by the actor's user id: a learner only ever sees their own work, never another learner's.
 */
export async function listOwnCourseworkForUnit(
  actor: Actor,
  lessonId: string
): Promise<{ submissions: SubmissionWithResultRow[]; canSubmit: boolean }> {
  if (!actor.authenticated) {
    throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  }
  // Unit-level informational flag (all assessments passed ⇒ nothing left to submit). The authoritative
  // per-ASSESSMENT open/closed decision is enforced at submit time (resolveSubmittableAssessment); the
  // learner UI derives per-item state from each submission's assessmentKey + result.
  const [submissions, unitPassed] = await Promise.all([
    listSubmissionsWithResultForLearnerUnit(actor.userId, lessonId),
    hasLearnerPassedUnit(actor.userId, lessonId)
  ]);
  return { submissions, canSubmit: !unitPassed };
}

/**
 * A single submission's detail (metadata + file keys), bound to the path course+unit and gated by
 * canReadCoursework (self / allocated tutor / Admin). A cross-course/unit id pairing → 404 (never reveal
 * the id exists elsewhere); a caller who may not read it → 403.
 */
export async function getCourseworkSubmissionForReader(
  actor: Actor,
  courseId: string,
  lessonId: string,
  submissionId: string
): Promise<CourseworkSubmissionRow> {
  const submission = await getSubmissionById(submissionId);
  if (!submission || submission.courseId !== courseId || submission.lessonId !== lessonId) {
    throw new AppError('Submission not found', ErrorCodes.NOT_FOUND, 404);
  }
  if (!(await canReadCoursework(actor, submission))) {
    throw new AppError('You do not have access to this submission', ErrorCodes.FORBIDDEN, 403);
  }
  return submission;
}

/** Signed download URLs for coursework keys — the guard (assertCourseworkDownloadAccess) runs in the route. */
export async function signCourseworkDownloads(keys: string[]): Promise<Record<string, string>> {
  return generateDocumentDownloadPresignedUrls(keys);
}
