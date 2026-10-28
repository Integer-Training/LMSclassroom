import { getUploadLimits } from '@cio/core/config/upload-limits';

const limits = getUploadLimits();

// API-specific constants (file size limits)
export const MAX_FILE_SIZE = limits.videoBytes;
export const MAX_DOCUMENT_SIZE = limits.documentBytes;
export const MAX_IMAGE_SIZE = limits.imageBytes;
export const MAX_EXERCISE_FILE_SIZE = limits.exerciseFileBytes;
export const MAX_AGENT_DOCUMENT_SIZE = limits.agentDocumentBytes;

/**
 * Hard ceiling on a multipart upload BODY the API will accept on the server-proxied image/agent-document routes
 * (hono bodyLimit: Content-Length pre-check + streaming count). It sits above the per-file cap so multipart framing
 * never trips it, and is never lower than 8 MB. Without it the whole body is buffered before the size check runs.
 */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const MIN_MULTIPART_BODY_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_UPLOAD_BODY_BYTES = Math.max(
  MIN_MULTIPART_BODY_BYTES,
  MAX_IMAGE_SIZE + MULTIPART_OVERHEAD_BYTES
);
export const MAX_AGENT_UPLOAD_BODY_BYTES = Math.max(
  MIN_MULTIPART_BODY_BYTES,
  MAX_AGENT_DOCUMENT_SIZE + MULTIPART_OVERHEAD_BYTES
);

export { getUploadLimits };

// API-specific constants (bucket names)
export const BUCKET_NAME = {
  VIDEOS: 'videos',
  DOCUMENTS: 'documents',
  MEDIA: 'media'
} as const;
