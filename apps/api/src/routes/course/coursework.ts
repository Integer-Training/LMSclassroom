import {
  ZCourseworkCreate,
  ZCourseworkDownload,
  ZCourseworkPresign,
  ZSubmissionIdParam
} from '@cio/utils/validation/coursework';
import {
  createCourseworkSubmission,
  getCourseworkSubmissionForReader,
  listOwnCourseworkForUnit,
  presignCourseworkUploads,
  signCourseworkDownloads
} from '@api/services/coursework/coursework';
import { assertCourseworkDownloadAccess, requireActor, requireCourseworkSubmit } from '@api/middlewares/guards';

import { Hono } from '@api/utils/hono';
import type { Actor } from '@cio/db/actor';
import { handleError } from '@api/utils/errors';
import { zValidator } from '@hono/zod-validator';

// Learner coursework upload (PearlLMS Phase 3 Step 4). Mounted under lessonRouter at
// /:lessonId/coursework, so courseId + lessonId come from the path. Coursework is the most sensitive
// data in the system — write is enrolled-learner-self-published only (requireCourseworkSubmit); reads
// are gated per-submission by canReadCoursework (self / allocated tutor / Admin — Manager and
// non-allocated tutors denied); files are only ever reachable through the guarded download endpoint.
export const courseworkRouter = new Hono()
  // Issue presigned upload URLs (server computes version + learner-scoped keys). Submit-guarded.
  .post('/presign', requireCourseworkSubmit, zValidator('json', ZCourseworkPresign), async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const courseId = c.req.param('courseId')!;
      const lessonId = c.req.param('lessonId')!;
      const { assessmentKey, submissionType, files } = c.req.valid('json');
      const data = await presignCourseworkUploads(actor, courseId, lessonId, assessmentKey, submissionType, files);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to prepare coursework upload');
    }
  })
  // Register the uploaded files as a versioned submission. Submit-guarded; keys bound to the caller.
  .post('/', requireCourseworkSubmit, zValidator('json', ZCourseworkCreate), async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const courseId = c.req.param('courseId')!;
      const lessonId = c.req.param('lessonId')!;
      const { assessmentKey, submissionType, version, files } = c.req.valid('json');
      const data = await createCourseworkSubmission(
        actor,
        courseId,
        lessonId,
        assessmentKey,
        submissionType,
        version,
        files
      );
      return c.json({ success: true, data }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to record coursework submission');
    }
  })
  // The caller's OWN submissions for this unit (self-scoped by actor id — no cross-learner leak).
  .get('/', requireActor(), async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const lessonId = c.req.param('lessonId')!;
      const data = await listOwnCourseworkForUnit(actor, lessonId);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to list coursework submissions');
    }
  })
  // Sign download URLs — each key is bound to a submission the caller may read (assertCourseworkDownloadAccess).
  .post('/download', requireActor(), zValidator('json', ZCourseworkDownload), async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const { keys } = c.req.valid('json');
      await assertCourseworkDownloadAccess(actor, keys);
      const urls = await signCourseworkDownloads(keys);
      return c.json({ success: true, urls }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to generate coursework download URLs');
    }
  })
  // A single submission's detail — gated per-submission by canReadCoursework (self / allocated tutor / Admin).
  .get('/:submissionId', requireActor(), zValidator('param', ZSubmissionIdParam), async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const courseId = c.req.param('courseId')!;
      const lessonId = c.req.param('lessonId')!;
      const { submissionId } = c.req.valid('param');
      const data = await getCourseworkSubmissionForReader(actor, courseId, lessonId, submissionId);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load coursework submission');
    }
  });
