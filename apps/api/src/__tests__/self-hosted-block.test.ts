import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { blockWhenSelfHosted } from '@api/middlewares/self-hosted';

// PearlLMS Phase 7 Step 5 — the disablement guard for the public API + automation surfaces (INTEGRATIONS.md
// W1/W2). On self-hosted it 404s every path (as if unmounted); otherwise it passes through.

const app = new Hono().use('*', blockWhenSelfHosted).get('/x', (c) => c.json({ ok: true }));
const original = process.env.PUBLIC_IS_SELFHOSTED;

afterEach(() => {
  if (original === undefined) delete process.env.PUBLIC_IS_SELFHOSTED;
  else process.env.PUBLIC_IS_SELFHOSTED = original;
});

describe('blockWhenSelfHosted', () => {
  it('404s every path when PUBLIC_IS_SELFHOSTED=true (surface disabled)', async () => {
    process.env.PUBLIC_IS_SELFHOSTED = 'true';
    const res = await app.request('/x');
    expect(res.status).toBe(404);
  });

  it('passes through when not self-hosted', async () => {
    process.env.PUBLIC_IS_SELFHOSTED = 'false';
    const res = await app.request('/x');
    expect(res.status).toBe(200);
  });
});
