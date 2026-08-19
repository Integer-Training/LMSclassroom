import type { Context, Next } from 'hono';

// PearlLMS Phase 7 Step 5 (docs/INTEGRATIONS.md W1/W2) — an honest config-off for external-integration surfaces
// the owner does not use (the public API v1 / Zapier target + automation-key management). On the self-hosted
// closed deployment these respond 404 for every path, exactly as if unmounted; a cloud build keeps them.
export const blockWhenSelfHosted = async (c: Context, next: Next) => {
  if (process.env.PUBLIC_IS_SELFHOSTED === 'true') {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  return next();
};
