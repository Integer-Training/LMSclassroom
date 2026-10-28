import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PearlLMS scalability Phase C2 — OG renders are cached in memory per siteName and concurrent requests share one
// render, so link-preview scrapers no longer cost DB reads + S3 + a paid Cloudflare render each time.

const mocks = vi.hoisted(() => ({
  getOrganizationBySiteName: vi.fn(),
  getActiveOrganizationPlan: vi.fn(),
  getCloudflarePngBuffer: vi.fn(),
  getCachedOrgSiteOgBuffer: vi.fn(),
  persistOrgSiteOgImage: vi.fn()
}));

vi.mock('@cio/db/queries/organization', () => ({
  getOrganizationBySiteName: mocks.getOrganizationBySiteName,
  getActiveOrganizationPlan: mocks.getActiveOrganizationPlan
}));
vi.mock('@api/utils/cloudflare', () => ({ getCloudflarePngBuffer: mocks.getCloudflarePngBuffer }));
vi.mock('@cio/email', () => ({ resolveThemeColor: () => '#1d4ed8' }));
vi.mock('@api/utils/org-site-og', () => ({
  extractOrgTagline: () => undefined,
  renderOrgSiteOg: () => ({ html: '<p/>', styles: '' })
}));
vi.mock('@cio/core/config/env', () => ({ env: { PUBLIC_IS_SELFHOSTED: 'true' } }));
vi.mock('@api/services/org/og-cache', () => ({
  getCachedOrgSiteOgBuffer: mocks.getCachedOrgSiteOgBuffer,
  getOrgSiteOgPublicUrl: () => null,
  persistOrgSiteOgImage: mocks.persistOrgSiteOgImage
}));

import { clearOrgSiteOgMemoryCache, generateOrgSiteOgImage } from '@api/services/org/og';

beforeEach(() => {
  clearOrgSiteOgMemoryCache();
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.getOrganizationBySiteName.mockResolvedValue({ id: 'o1', name: 'Pearl', theme: 'blue', landingpage: null });
  mocks.getActiveOrganizationPlan.mockResolvedValue(null);
  mocks.getCachedOrgSiteOgBuffer.mockResolvedValue(null);
  mocks.getCloudflarePngBuffer.mockResolvedValue(Buffer.from('png'));
  mocks.persistOrgSiteOgImage.mockResolvedValue(null);
  delete process.env.ORG_CACHE_TTL_MS;
  delete process.env.ORG_OG_CACHE_TTL_MS;
});

afterEach(() => {
  delete process.env.ORG_CACHE_TTL_MS;
  delete process.env.ORG_OG_CACHE_TTL_MS;
});

describe('generateOrgSiteOgImage memory cache', () => {
  it('renders once and serves the next request from memory (no DB, S3 or Cloudflare)', async () => {
    const a = await generateOrgSiteOgImage('pearl');
    const b = await generateOrgSiteOgImage('pearl');

    expect(b.etag).toBe(a.etag);
    expect(mocks.getOrganizationBySiteName).toHaveBeenCalledTimes(1);
    expect(mocks.getCloudflarePngBuffer).toHaveBeenCalledTimes(1);
  });

  it('concurrent requests for one siteName share a single render (single-flight)', async () => {
    await Promise.all([
      generateOrgSiteOgImage('pearl'),
      generateOrgSiteOgImage('pearl'),
      generateOrgSiteOgImage('pearl')
    ]);

    expect(mocks.getCloudflarePngBuffer).toHaveBeenCalledTimes(1);
  });

  it('different siteNames are cached separately', async () => {
    await generateOrgSiteOgImage('a');
    await generateOrgSiteOgImage('b');

    expect(mocks.getCloudflarePngBuffer).toHaveBeenCalledTimes(2);
  });

  it('a 404 / failure is not cached', async () => {
    mocks.getOrganizationBySiteName.mockResolvedValueOnce(null);
    await expect(generateOrgSiteOgImage('ghost')).rejects.toThrow();

    await expect(generateOrgSiteOgImage('ghost')).resolves.toBeTruthy();
  });

  it('ORG_CACHE_TTL_MS=0 disables the memory cache (kill switch)', async () => {
    process.env.ORG_CACHE_TTL_MS = '0';
    await generateOrgSiteOgImage('pearl');
    await generateOrgSiteOgImage('pearl');

    expect(mocks.getCloudflarePngBuffer).toHaveBeenCalledTimes(2);
  });
});
