import { describe, expect, it, vi } from 'vitest';
import type { Context } from 'hono';

// Scalability Phase A (spoofable-client-ip): no Cloudflare/nginx is in front of the api, so `cf-connecting-ip` and
// `x-real-ip` are attacker-controlled. The per-IP limiters must key on Caddy's X-Forwarded-For (first hop) and fall
// back to the socket address — never on those two headers.
vi.mock('@hono/node-server/conninfo', () => ({
  getConnInfo: (c: { __remote?: string }) => ({ remote: { address: c.__remote } })
}));

import { extractClientIp, ipKeyGenerator } from '@api/utils/redis/key-generators';

function ctx(headers: Record<string, string>, remote?: string): Context {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    req: { header: (name: string) => lower[name.toLowerCase()] },
    __remote: remote
  } as unknown as Context;
}

describe('extractClientIp', () => {
  it('ignores a client-supplied cf-connecting-ip and keys on the x-forwarded-for first hop', () => {
    const c = ctx({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }, '172.18.0.5');
    expect(extractClientIp(c)).toBe('9.9.9.9');
    expect(ipKeyGenerator(c)).toBe('ip:9.9.9.9');
  });

  it('ignores a client-supplied x-real-ip', () => {
    const c = ctx({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }, '172.18.0.5');
    expect(extractClientIp(c)).toBe('9.9.9.9');
  });

  it('falls back to the socket address (not the spoofable headers) when there is no x-forwarded-for', () => {
    const c = ctx({ 'cf-connecting-ip': '1.2.3.4', 'x-real-ip': '5.6.7.8' }, '::ffff:172.18.0.5');
    expect(extractClientIp(c)).toBe('172.18.0.5');
  });

  it('returns "unknown" when nothing is available', () => {
    expect(extractClientIp(ctx({}))).toBe('unknown');
  });
});
