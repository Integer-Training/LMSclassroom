import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  EMPTY_ORG_LOOKUP_TTL_MS,
  cachedOrgLookup,
  clearOrgLookupCache,
  orgLookupKey
} from '../../../../dashboard/src/lib/features/app/org-lookup-cache';
import { toPublicLocals } from '../../../../dashboard/src/lib/utils/services/auth/public-locals';
import {
  clearOrgSiteOgCdnCache,
  resolveOrgSiteOgImageUrl
} from '../../../../dashboard/src/lib/utils/functions/org-site-og-url';

// PearlLMS scalability Phase C1 — the dashboard root layout: org lookups are cached (60s, single-flight, short
// negative TTL), the OG warm fetch and CDN HEAD per navigation are gone, and the client only gets the locals it uses.

const root = path.resolve(__dirname, '../../../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

beforeEach(() => {
  clearOrgLookupCache();
  clearOrgSiteOgCdnCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.ORG_CACHE_TTL_MS;
});

describe('cachedOrgLookup', () => {
  const ORG = { id: 'o1', siteName: 'pearl', landingpage: { header: { title: 'Hi' } } };

  it('serves repeat lookups for the same key from memory', async () => {
    const loader = vi.fn(async () => ORG);
    const key = orgLookupKey('site', 'pearl', 'pearl.example.com');

    await cachedOrgLookup(key, loader, 60_000);
    await cachedOrgLookup(key, loader, 60_000);

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('keys by mode|siteName|hostname so tenants / custom domains never cross', async () => {
    const loader = vi.fn(async () => ORG);

    await cachedOrgLookup(orgLookupKey('site', 'a', 'a.example.com'), loader, 60_000);
    await cachedOrgLookup(orgLookupKey('site', 'b', 'b.example.com'), loader, 60_000);
    await cachedOrgLookup(orgLookupKey('domain', '', 'learn.customer.com'), loader, 60_000);

    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('concurrent lookups share one API call', async () => {
    const loader = vi.fn(async () => ORG);
    await Promise.all([cachedOrgLookup('k', loader, 60_000), cachedOrgLookup('k', loader, 60_000)]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('never caches an empty answer (null / []) longer than ~2s, so a brief API blip cannot stick', async () => {
    vi.useFakeTimers();
    const loader = vi.fn<() => Promise<unknown>>().mockResolvedValue(null);

    await cachedOrgLookup('k', loader, 60_000);
    await cachedOrgLookup('k', loader, 60_000);
    expect(loader).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(EMPTY_ORG_LOOKUP_TTL_MS + 100);
    loader.mockResolvedValue(ORG);
    expect(await cachedOrgLookup('k', loader, 60_000)).toEqual(ORG);
    expect(loader).toHaveBeenCalledTimes(2);

    const emptyList = vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
    await cachedOrgLookup('list', emptyList, 60_000);
    await vi.advanceTimersByTimeAsync(EMPTY_ORG_LOOKUP_TTL_MS + 100);
    await cachedOrgLookup('list', emptyList, 60_000);
    expect(emptyList).toHaveBeenCalledTimes(2);
  });

  it('errors are not cached', async () => {
    const loader = vi
      .fn<() => Promise<typeof ORG>>()
      .mockRejectedValueOnce(new Error('api down'))
      .mockResolvedValue(ORG);

    await expect(cachedOrgLookup('k', loader, 60_000)).rejects.toThrow('api down');
    expect(await cachedOrgLookup('k', loader, 60_000)).toEqual(ORG);
  });

  it('ttl 0 (ORG_CACHE_TTL_MS=0) disables caching', async () => {
    const loader = vi.fn(async () => ORG);
    await cachedOrgLookup('k', loader, 0);
    await cachedOrgLookup('k', loader, 0);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('returns a copy so a consumer can never mutate the shared entry', async () => {
    const loader = vi.fn(async () => structuredClone(ORG));
    const first = await cachedOrgLookup('k', loader, 60_000);
    first.siteName = 'MUTATED';

    expect((await cachedOrgLookup('k', loader, 60_000)).siteName).toBe('pearl');
  });
});

describe('toPublicLocals (root layout payload)', () => {
  it('keeps what the client uses and drops the session token / IP / user agent / org plan payload', () => {
    const publicLocals = toPublicLocals({
      user: { id: 'u1', email: 'a@b.test', name: 'A' },
      session: { token: 'SECRET', ipAddress: '1.2.3.4', userAgent: 'ua' },
      profile: { id: 'u1', locale: 'en', fullname: 'A', email: 'a@b.test' },
      organizations: [{ id: 'o1', plan: { customerId: 'cus_123' } }],
      orgRoles: { o1: 1 },
      status: 'ACTIVE',
      actor: { authenticated: true, userId: 'u1', role: 'ADMIN', status: 'ACTIVE', orgId: 'o1' }
    } as never);

    expect(publicLocals.user).toEqual({ id: 'u1', email: 'a@b.test', name: 'A' });
    expect(publicLocals.profile).toEqual({ locale: 'en' });
    expect(publicLocals.orgRoles).toEqual({ o1: 1 });
    expect(publicLocals.status).toBe('ACTIVE');
    expect(publicLocals.actor).toMatchObject({ authenticated: true, role: 'ADMIN' });

    const serialised = JSON.stringify(publicLocals);
    expect(serialised).not.toContain('SECRET');
    expect(serialised).not.toContain('1.2.3.4');
    expect(serialised).not.toContain('cus_123');
    expect(publicLocals).not.toHaveProperty('session');
    expect(publicLocals).not.toHaveProperty('organizations');
  });

  it('anonymous request (empty locals) -> user null, no throw', () => {
    expect(toPublicLocals({})).toEqual({ user: null, profile: null });
    expect(toPublicLocals(undefined)).toEqual({ user: null, profile: null });
  });
});

describe('OG CDN HEAD memo', () => {
  const opts = {
    siteName: 'pearl',
    pageOrigin: 'https://learn.example.com',
    isSelfHosted: false,
    mediaCdnUrl: 'https://img.cdn.example.com',
    publicServerUrl: 'https://api.example.com'
  };

  it('a missing CDN object (negative) is remembered: one HEAD, then straight to the API url', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal('fetch', fetchMock);

    const a = await resolveOrgSiteOgImageUrl(opts);
    const b = await resolveOrgSiteOgImageUrl(opts);

    expect(a).toContain('api.example.com');
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a present CDN object is remembered too', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const a = await resolveOrgSiteOgImageUrl(opts);
    await resolveOrgSiteOgImageUrl(opts);

    expect(a).toContain('img.cdn.example.com');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ORG_CACHE_TTL_MS=0 disables the memo', async () => {
    process.env.ORG_CACHE_TTL_MS = '0';
    const fetchMock = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal('fetch', fetchMock);

    await resolveOrgSiteOgImageUrl(opts);
    await resolveOrgSiteOgImageUrl(opts);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('source guards', () => {
  it('root layout no longer fires the per-navigation OG warm fetch', () => {
    const src = read('apps/dashboard/src/routes/+layout.server.ts');
    expect(src).not.toMatch(/void fetch\(/);
    expect(src).not.toMatch(/warmUrl|resolveOrgSiteOgWarmUrl/);
  });

  it('root layout ships trimmed locals, not the raw session', () => {
    const src = read('apps/dashboard/src/routes/+layout.server.ts');
    expect(src).toMatch(/locals: toPublicLocals\(locals\)/);
  });

  it('canonical / og:url read url.pathname inside untrack so client navigations do not re-run the root load', () => {
    const src = read('apps/dashboard/src/lib/utils/functions/metaTags.server.ts');
    expect(src).toMatch(/untrack\(\(\) => new URL\(url\.pathname, url\.origin\)\.href\)/);
    expect(src).not.toMatch(/canonical: new URL\(url\.pathname/);
    expect(read('apps/dashboard/src/routes/+layout.server.ts')).toMatch(/getBaseMetaTags\(url, orgSiteInfo, untrack\)/);
  });

  it('org lookups in layout-setup go through the cache', () => {
    const src = read('apps/dashboard/src/lib/features/app/layout-setup.ts');
    expect(src.match(/cachedOrgLookup\(/g)?.length).toBe(3);
  });
});
