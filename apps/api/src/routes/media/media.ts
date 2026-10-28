import { AppError, ErrorCodes } from '@api/utils/errors';

import { Hono } from '@api/utils/hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { every } from 'hono/combine';
import { authMiddleware } from '@api/middlewares/auth';
import { createRateLimiter } from '@api/middlewares/rate-limiter';
import { MAX_IMAGE_SIZE, MAX_IMAGE_UPLOAD_BODY_BYTES } from '@api/constants/upload';
import { handleError, isBodyLimitError } from '@api/utils/errors';
import { mediaImageUploadKeyGenerator } from '@api/utils/redis/key-generators';
import { uploadImage } from '@api/services/media';

const DAY_MS = 24 * 60 * 60 * 1000;

// Phase I — per-user caps on the server-proxied image upload (avatars, editor images, thumbnails). Generous for real
// use (a burst of pasted images), but a script can no longer fill the public media bucket unbounded.
const imageUploadLimit = every(
  createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: 'Too many uploads. Please slow down.',
    keyGenerator: mediaImageUploadKeyGenerator
  }),
  createRateLimiter({
    windowMs: DAY_MS,
    maxRequests: 500,
    message: 'Daily upload limit reached. Please try again tomorrow.',
    keyGenerator: (c) => `${mediaImageUploadKeyGenerator(c)}:day`
  })
);

const imageTooLarge = (c: Context) =>
  c.json(
    {
      success: false,
      error: `File size exceeds maximum of ${MAX_IMAGE_SIZE / 1024 / 1024}MB`,
      code: ErrorCodes.VALIDATION_ERROR
    },
    413
  );

// Reject an oversized multipart body from its Content-Length (or while counting a chunked one) before it is buffered.
const imageBodyLimit = bodyLimit({ maxSize: MAX_IMAGE_UPLOAD_BODY_BYTES, onError: imageTooLarge });

export const mediaRouter = new Hono().post('/image', authMiddleware, imageUploadLimit, imageBodyLimit, async (c) => {
  try {
    const body = await c.req.parseBody();

    const file = body.file;

    if (!file || !(file instanceof File)) {
      throw new AppError(new Error('No file provided'), ErrorCodes.VALIDATION_ERROR, 400);
    }

    const result = await uploadImage(file);

    return c.json({
      success: true,
      url: result.url,
      fileKey: result.fileKey,
      message: 'Image uploaded successfully'
    });
  } catch (error) {
    if (isBodyLimitError(error)) return imageTooLarge(c);

    return handleError(c, error, 'Failed to upload image');
  }
});
