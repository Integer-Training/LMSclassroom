import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { correlationId, CORRELATION_ID_HEADER } from '@api/middlewares/correlation-id';
import { handleError, AppError, ErrorCodes } from '@api/utils/errors';

// PearlLMS Phase-10 HP/SA-5 — sanitised error hygiene. A server error must return a GENERIC message + a
// correlation id and NOTHING internal (no stack, no DSN, no path); the same id is echoed in the response header
// (and logged server-side) so a user-reported ref maps to its log line. Deliberate 4xx messages are preserved.

const SECRET = 'postgres://user:pa55@db.internal:5432/secret';

function makeApp() {
  const app = new Hono();
  app.use('*', correlationId());
  app.get('/ok', (c) => c.json({ ok: true }));
  app.onError((err, c) => handleError(c, err, 'An unexpected error occurred'));
  app.get('/server-error', () => {
    throw new AppError(`db exploded: ${SECRET}`, ErrorCodes.INTERNAL_ERROR, 500);
  });
  app.get('/unexpected', () => {
    throw new Error(`raw stacktrace with ${SECRET}`);
  });
  app.get('/denied', () => {
    throw new AppError('You do not have access to this resource', ErrorCodes.FORBIDDEN, 403);
  });
  return app;
}

describe('error hygiene (HP/SA-5)', () => {
  const app = makeApp();
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeAll(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterAll(() => errSpy.mockRestore());

  it('every response carries an x-correlation-id header', async () => {
    const res = await app.request('/ok');
    expect(res.headers.get(CORRELATION_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('a server error returns a GENERIC message + correlation id, and leaks nothing internal', async () => {
    const res = await app.request('/server-error');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('An unexpected error occurred');
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(JSON.stringify(body)).not.toContain('exploded');
    expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    // the id in the body matches the response header, so a reported ref is greppable in the logs
    expect(body.correlationId).toBe(res.headers.get(CORRELATION_ID_HEADER));
  });

  it('an unexpected (non-App) error is also genericised with an id — no raw stack/DSN', async () => {
    const res = await app.request('/unexpected');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('An unexpected error occurred');
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(body.correlationId).toBeTruthy();
  });

  it('a deliberate 4xx (denied) keeps its user-facing message and does NOT attach an id', async () => {
    const res = await app.request('/denied');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('You do not have access to this resource');
    expect(body.correlationId).toBeUndefined();
  });

  it('an unsafe inbound correlation id is replaced; a safe one is threaded through', async () => {
    const unsafe = await app.request('/ok', { headers: { [CORRELATION_ID_HEADER]: '<script>alert(1)</script>' } });
    expect(unsafe.headers.get(CORRELATION_ID_HEADER)).not.toContain('<script>');

    const safe = await app.request('/ok', { headers: { [CORRELATION_ID_HEADER]: 'req-abc123DEF' } });
    expect(safe.headers.get(CORRELATION_ID_HEADER)).toBe('req-abc123DEF');
  });
});
