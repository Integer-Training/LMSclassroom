import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Scalability Phase A: credential-bearing / hot-path debug logs must not come back. Source-level guard (cheap, no
// runtime wiring needed): a regression here means session cookies or token URLs are being written to container logs.
const root = path.resolve(__dirname, '../../../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

describe('credential-leaking logs stay removed', () => {
  it('getApiHeaders does not log the cookie header', () => {
    const src = read('apps/dashboard/src/lib/utils/services/api/index.ts');
    expect(src).not.toMatch(/console\.log\(\s*['"]headers['"]/);
  });

  it('email verification does not log options (token URLs)', () => {
    const src = read('packages/db/src/auth/email-verification.ts');
    expect(src).not.toMatch(/console\.log\([^)]*options/);
  });

  it('root layout does not dump page data (session row) to the browser console', () => {
    const src = read('apps/dashboard/src/routes/+layout.svelte');
    expect(src).not.toMatch(/console\.log\(\s*['"]Layout['"]/);
  });
});

describe('agent AI endpoints are rate limited', () => {
  it('chat and upload routes wire per-user minute + day limiters', () => {
    const src = read('apps/api/src/routes/agent/agent.ts');
    expect(src).toMatch(/\.post\('\/chat',[^]*?agentChatLimit,/);
    expect(src).toMatch(/\.post\('\/upload',[^]*?agentUploadLimit,/);
  });
});
