import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

// Scalability Phase A (automation-key): the `lastUsedAt` touch is fire-and-forget + throttled, and a downstream
// handler error must no longer be mislabelled as a 401.
const authenticate = vi.fn();
const touch = vi.fn();

vi.mock('@api/services/organization/automation-key', () => ({
  authenticateOrganizationApiKeyService: (...a: unknown[]) => authenticate(...a),
  touchOrganizationApiKeyLastUsedService: (...a: unknown[]) => touch(...a)
}));

import { automationKeyMiddleware } from '@api/middlewares/automation-key';

const key = (id: string) => ({ id, organizationId: 'org-1', createdByProfileId: 'p-1' });

function build() {
  return new Hono()
    .use('*', automationKeyMiddleware)
    .get('/ok', (c) => c.json({ ok: true }))
    .get('/boom', () => {
      throw new Error('downstream failure');
    })
    .onError((_err, c) => c.json({ error: 'handler-error' }, 500));
}

const auth = { headers: { Authorization: 'Bearer secret' } };

describe('automationKeyMiddleware', () => {
  beforeEach(() => {
    authenticate.mockReset();
    touch.mockReset();
  });

  it('401s when the bearer token is missing', async () => {
    const res = await build().request('/ok');
    expect(res.status).toBe(401);
  });

  it('401s when the key does not authenticate', async () => {
    authenticate.mockRejectedValue(new Error('Invalid API key'));
    const res = await build().request('/ok', auth);
    expect(res.status).toBe(401);
  });

  it('does not relabel a downstream handler error as 401', async () => {
    authenticate.mockResolvedValue(key('k-boom'));
    touch.mockResolvedValue(undefined);
    const res = await build().request('/boom', auth);
    expect(res.status).toBe(500);
  });

  it('throttles the lastUsedAt touch to once per key per interval', async () => {
    authenticate.mockResolvedValue(key('k-throttle'));
    touch.mockResolvedValue(undefined);
    const app = build();
    await app.request('/ok', auth);
    await app.request('/ok', auth);
    await app.request('/ok', auth);
    expect(touch).toHaveBeenCalledTimes(1);
  });

  it('a failing touch never fails the request', async () => {
    authenticate.mockResolvedValue(key('k-touch-fails'));
    touch.mockRejectedValue(new Error('db down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await build().request('/ok', auth);
    expect(res.status).toBe(200);
    errSpy.mockRestore();
  });
});
