import {
  ZCourseDocumentPresignUrlUpload,
  ZCourseDownloadPresignedUrl,
  ZCoursePresignUrlUpload
} from '@cio/utils/validation/course';
import { describeRoute, validator } from 'hono-openapi';
import {
  generateDocumentDownloadPresignedUrls,
  generateDocumentUploadPresignedUrl,
  generateVideoDownloadPresignedUrls,
  generateVideoUploadPresignedUrl
} from '@cio/core/utils/s3';

import { Hono } from '@api/utils/hono';
import type { Actor } from '@cio/db/actor';
import { requireActor, assertCourseMaterialDownloadAccess } from '@api/middlewares/guards';
import { isRole } from '@cio/utils/auth';
import { getCourseOrgId } from '@cio/db/queries/reports';
import { createRateLimiter } from '@api/middlewares/rate-limiter';
import { extractClientIp } from '@api/utils/redis/key-generators';
import { UPLOAD_RATE_LIMIT } from '@cio/utils/constants';
import { generateFileKey, generateMaterialFileKey } from '@cio/core/utils/upload';
import { AppError, handleError } from '@api/utils/errors';
import { MAX_DOCUMENT_SIZE, MAX_FILE_SIZE } from '@api/constants/upload';

// PearlLMS Phase-10 HP/SW-19 (O3) — per-user cap on presigned UPLOAD grants (30/hour). Bounds storage-abuse /
// cost from a compromised or scripted session minting unbounded upload URLs (prod-only, like the base limiter).
const uploadRateLimit = createRateLimiter({
  windowMs: UPLOAD_RATE_LIMIT.windowMs,
  maxRequests: UPLOAD_RATE_LIMIT.maxPerWindow,
  message: 'Upload limit reached. Please try again later.',
  keyGenerator: (c) => {
    const actor = c.get('actor') as Actor | undefined;
    return `upload:${actor?.userId ?? extractClientIp(c)}`;
  }
});

/**
 * Advisory check on client-reported `fileSize`. Upload bytes go directly to object storage
 * via the presigned PUT URL, so omitting `fileSize` (or understating it) bypasses this guard.
 * Real enforcement requires storage-side policies (bucket max object size, etc.).
 */
function assertPresignFileSizeWithinLimit(fileSize: number | undefined, maxBytes: number): void {
  if (fileSize != null && fileSize > maxBytes) {
    throw new AppError(`File size exceeds maximum of ${maxBytes / 1024 / 1024}MB`, 'FILE_TOO_LARGE', 413);
  }
}

// Response schemas for OpenAPI documentation
const PresignUploadResponse = {
  type: 'object' as const,
  properties: {
    success: { type: 'boolean' as const },
    url: { type: 'string' as const },
    fileKey: { type: 'string' as const },
    message: { type: 'string' as const }
  },
  required: ['success', 'url', 'fileKey', 'message']
};

const PresignDownloadResponse = {
  type: 'object' as const,
  properties: {
    success: { type: 'boolean' as const },
    urls: {
      type: 'object' as const,
      additionalProperties: { type: 'string' as const }
    },
    message: { type: 'string' as const }
  },
  required: ['success', 'urls', 'message']
};

export const presignRouter = new Hono()
  .post(
    '/video/upload',
    requireActor(),
    uploadRateLimit,
    describeRoute({
      description: 'Generate a pre-signed URL for video upload',
      responses: {
        200: {
          description: 'Pre-signed URL generated successfully',
          content: {
            'application/json': {
              schema: PresignUploadResponse
            }
          }
        },
        400: {
          description: 'Invalid request body'
        },
        401: {
          description: 'Unauthorized'
        }
      },
      tags: ['Presign']
    }),
    validator('json', ZCoursePresignUrlUpload),
    async (c) => {
      try {
        const body = c.req.valid('json');

        const { fileName, fileType, fileSize } = body;

        assertPresignFileSizeWithinLimit(fileSize, MAX_FILE_SIZE);

        const fileKey = generateFileKey(fileName);

        const presignedUrl = await generateVideoUploadPresignedUrl(fileKey, fileType);

        return c.json({
          success: true,
          url: presignedUrl,
          fileKey,
          message: 'Pre-signed URL generated successfully'
        });
      } catch (error) {
        return handleError(c, error, 'Failed to generate video upload URL');
      }
    }
  )
  .post(
    '/document/upload',
    requireActor(),
    uploadRateLimit,
    describeRoute({
      description: 'Generate a pre-signed URL for document upload',
      responses: {
        200: {
          description: 'Document pre-signed URL generated successfully',
          content: {
            'application/json': {
              schema: PresignUploadResponse
            }
          }
        },
        400: {
          description: 'Invalid request body'
        },
        401: {
          description: 'Unauthorized'
        }
      },
      tags: ['Presign']
    }),
    validator('json', ZCourseDocumentPresignUrlUpload),
    async (c) => {
      try {
        const body = c.req.valid('json');

        const { fileName, fileType, fileSize, courseId } = body;

        assertPresignFileSizeWithinLimit(fileSize, MAX_DOCUMENT_SIZE);

        // PearlLMS Phase-10 HP/SW-6 — a material upload (courseId present) writes an authoring key under
        // materials/{courseId}/…. Bind it: the caller must be an ADMIN of the course's own org (material
        // authoring is admin-only, Phase 2) and must declare a size. Previously any authed actor could name
        // any courseId and sign a material key into another org's namespace (the id was an unbound string).
        if (courseId) {
          const actor = c.get('actor') as Actor;
          const sourceOrgId = await getCourseOrgId(courseId);
          if (!sourceOrgId || sourceOrgId !== actor.orgId || !isRole(actor, 'ADMIN')) {
            throw new AppError('Course not found', 'NOT_FOUND', 404);
          }
          if (fileSize == null) {
            throw new AppError('fileSize is required for material uploads', 'BAD_REQUEST', 400);
          }
        }

        // PearlLMS Phase 2 Step 4: material uploads (courseId present) are namespaced under
        // materials/{courseId}/…; other document uploads (e.g. exercise submissions) keep the flat key.
        const fileKey = courseId ? generateMaterialFileKey(courseId, fileName) : generateFileKey(fileName);

        const presignedUrl = await generateDocumentUploadPresignedUrl(fileKey, fileType);

        return c.json({
          success: true,
          url: presignedUrl,
          fileKey,
          message: 'Document pre-signed URL generated successfully'
        });
      } catch (error) {
        return handleError(c, error, 'Failed to generate document upload URL');
      }
    }
  )
  .post(
    '/video/download',
    requireActor(),
    describeRoute({
      description: 'Generate pre-signed URLs for video download',
      responses: {
        200: {
          description: 'Video URLs retrieved successfully',
          content: {
            'application/json': {
              schema: PresignDownloadResponse
            }
          }
        },
        400: {
          description: 'Invalid request body'
        },
        401: {
          description: 'Unauthorized'
        }
      },
      tags: ['Presign']
    }),
    validator('json', ZCourseDownloadPresignedUrl),
    async (c) => {
      try {
        const body = c.req.valid('json');

        const { keys, courseId } = body;

        // Gap G3: bind the download to the course + content-read rule (staff, or enrolled learner of a
        // published course; non-staff limited to the course's current material keys).
        await assertCourseMaterialDownloadAccess(c.get('actor') as Actor, courseId, keys);

        const signedUrls = await generateVideoDownloadPresignedUrls(keys);

        return c.json({
          success: true,
          urls: signedUrls,
          message: 'Video URLs retrieved successfully'
        });
      } catch (error) {
        return handleError(c, error, 'Failed to generate video download URLs');
      }
    }
  )
  .post(
    '/document/download',
    requireActor(),
    describeRoute({
      description: 'Generate pre-signed URLs for document download',
      responses: {
        200: {
          description: 'Document URLs retrieved successfully',
          content: {
            'application/json': {
              schema: PresignDownloadResponse
            }
          }
        },
        400: {
          description: 'Invalid request body'
        },
        401: {
          description: 'Unauthorized'
        }
      },
      tags: ['Presign']
    }),
    validator('json', ZCourseDownloadPresignedUrl),
    async (c) => {
      try {
        const body = c.req.valid('json');

        const { keys, courseId } = body;

        // Gap G3: same course-binding + content-read guard as video download.
        await assertCourseMaterialDownloadAccess(c.get('actor') as Actor, courseId, keys);

        const signedUrls = await generateDocumentDownloadPresignedUrls(keys);

        return c.json({
          success: true,
          urls: signedUrls,
          message: 'Document URLs retrieved successfully'
        });
      } catch (error) {
        return handleError(c, error, 'Failed to generate document download URLs');
      }
    }
  );
