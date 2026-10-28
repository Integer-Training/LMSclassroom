import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

// Phase I (proxy-buffers-25mb) — /media/image rejects an oversized multipart body from its Content-Length (or while
// counting a chunked body) BEFORE it is buffered, and is behind a per-user limiter. A 4 MB image still uploads
// (learner avatars stay allowed); the precise per-file 5 MB message in uploadImage is untouched.

const limiterConfigs = vi.hoisted(
  () => [] as { windowMs?: number; maxRequests?: number; keyGenerator?: (c: unknown) => string }[]
);
vi.mock('@api/middlewares/rate-limiter', () => ({
  createRateLimiter: (opts: { windowMs?: number; maxRequests?: number; keyGenerator?: (c: unknown) => string }) => {
    limiterConfigs.push(opts);
    return async (_c: unknown, next: () => Promise<void>) => next();
  }
}));
vi.mock('@api/middlewares/auth', () => ({
  authMiddleware: async (_c: unknown, next: () => Promise<void>) => next()
}));
vi.mock('@api/services/media', () => ({
  uploadImage: vi.fn(async (file: File) => ({ url: `https://m.test/${file.name}`, fileKey: file.name }))
}));

import { mediaRouter } from '@api/routes/media/media';
import { uploadImage } from '@api/services/media';
import { MAX_AGENT_UPLOAD_BODY_BYTES, MAX_IMAGE_UPLOAD_BODY_BYTES } from '@api/constants/upload';
import { mediaImageUploadKeyGenerator } from '@api/utils/redis/key-generators';

const app = new Hono().route('/media', mediaRouter);

function imageForm(bytes: number): FormData {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], 'pic.png', { type: 'image/png' }));
  return form;
}

beforeEach(() => {
  vi.mocked(uploadImage).mockClear();
});

describe('/media/image body limit', () => {
  it('a 4 MB image uploads', async () => {
    const res = await app.request('/media/image', { method: 'POST', body: imageForm(4 * 1024 * 1024) });
    expect(res.status).toBe(200);
    expect(uploadImage).toHaveBeenCalledTimes(1);
  });

  it('an 8 MB image is rejected with 413 before uploadImage runs', async () => {
    const res = await app.request('/media/image', { method: 'POST', body: imageForm(8 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('a declared Content-Length over the cap is refused without reading the body', async () => {
    const res = await app.request('/media/image', {
      method: 'POST',
      headers: { 'content-length': String(64 * 1024 * 1024), 'content-type': 'multipart/form-data; boundary=x' },
      body: 'tiny'
    });
    expect(res.status).toBe(413);
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('the ceilings sit at or above 8 MB and above the per-file caps', () => {
    expect(MAX_IMAGE_UPLOAD_BODY_BYTES).toBeGreaterThanOrEqual(8 * 1024 * 1024);
    expect(MAX_AGENT_UPLOAD_BODY_BYTES).toBeGreaterThanOrEqual(8 * 1024 * 1024);
  });
});

describe('/media/image per-user limiter', () => {
  it('registers a per-minute and a per-day limiter keyed per user', () => {
    expect(limiterConfigs.length).toBeGreaterThanOrEqual(2);
    const windows = limiterConfigs.map((c) => c.windowMs);
    expect(windows).toContain(60 * 1000);
    expect(windows).toContain(24 * 60 * 60 * 1000);
    const ctx = { get: (k: string) => (k === 'user' ? { id: 'u1' } : undefined) };
    expect(mediaImageUploadKeyGenerator(ctx as never)).toBe('user:u1:media:image');
    // each limiter is real use friendly (not the 100/min global) but bounded
    for (const c of limiterConfigs) expect(c.maxRequests).toBeLessThanOrEqual(500);
  });
});
