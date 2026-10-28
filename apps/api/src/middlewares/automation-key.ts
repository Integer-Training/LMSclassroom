import { Context, Next } from 'hono';

import {
  authenticateOrganizationApiKeyService,
  touchOrganizationApiKeyLastUsedService
} from '@api/services/organization/automation-key';

/** `lastUsedAt` is informational only, so write it at most once per key per minute (per process). */
const LAST_USED_TOUCH_INTERVAL_MS = 60_000;
const lastTouchedAt = new Map<string, number>();

function touchLastUsedThrottled(automationKey: Parameters<typeof touchOrganizationApiKeyLastUsedService>[0]) {
  const now = Date.now();
  const previous = lastTouchedAt.get(automationKey.id);

  if (previous !== undefined && now - previous < LAST_USED_TOUCH_INTERVAL_MS) return;

  lastTouchedAt.set(automationKey.id, now);

  // Fire-and-forget: a failed bookkeeping write must never fail or delay the request.
  void touchOrganizationApiKeyLastUsedService(automationKey).catch((error) => {
    console.error('automation-key: failed to touch lastUsedAt', error instanceof Error ? error.message : error);
  });
}

export const automationKeyMiddleware = async (c: Context, next: Next) => {
  try {
    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json(
        {
          success: false,
          error: 'Unauthorized',
          code: 'UNAUTHORIZED'
        },
        401
      );
    }

    const apiKey = authHeader.replace('Bearer ', '').trim();
    const automationKey = await authenticateOrganizationApiKeyService(apiKey);

    c.set('automationKey', automationKey);
    c.set('orgId', automationKey.organizationId);
    c.set('actorId', automationKey.createdByProfileId);

    touchLastUsedThrottled(automationKey);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unauthorized',
        code: 'UNAUTHORIZED'
      },
      401
    );
  }

  // Outside the try/catch so a downstream handler error is not mislabelled as a 401.
  await next();
};
