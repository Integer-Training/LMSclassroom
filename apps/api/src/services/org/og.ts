import { createHash } from 'crypto';

import { AppError, ErrorCodes } from '@api/utils/errors';
import { getCloudflarePngBuffer } from '@api/utils/cloudflare';
import { resolveThemeColor } from '@cio/email';
import { getActiveOrganizationPlan, getOrganizationBySiteName } from '@cio/db/queries/organization';
import { extractOrgTagline, renderOrgSiteOg } from '@api/utils/org-site-og';
import { isOrgOnFreePlan } from '@cio/utils/plans';
import { env } from '@cio/core/config/env';
import { TtlCache, parseTtlMs } from '@cio/utils/cache';
import { getCachedOrgSiteOgBuffer, getOrgSiteOgPublicUrl, persistOrgSiteOgImage } from '@api/services/org/og-cache';

const DEFAULT_OG_IMAGE = 'https://brand.cdn.clsrio.com/og/classroomio-opengraph.jpg';
const OG_VIEWPORT = { width: 1200, height: 630, deviceScaleFactor: 2 } as const;
const isSelfHosted = env.PUBLIC_IS_SELFHOSTED === 'true';

export function normalizeOrgOgSiteName(rawSiteName: string): string {
  return rawSiteName.endsWith('.png') ? rawSiteName.slice(0, -4) : rawSiteName;
}

export function getOrgSiteOgFallbackImageUrl(): string {
  return DEFAULT_OG_IMAGE;
}

export { getOrgSiteOgPublicUrl };

function buildOrgSiteOgEtag(payload: {
  siteName: string;
  orgName: string;
  logoUrl?: string;
  tagline?: string;
  themeColor: string;
  showWatermark: boolean;
}): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

// In-memory render cache per siteName: link-preview scrapers hit this route constantly and each miss cost two DB
// reads, an S3 HEAD+GET and potentially a paid Cloudflare render. Concurrent requests for the same siteName share ONE
// in-flight render (single-flight). 5 min by default; ORG_CACHE_TTL_MS=0 (shared kill switch) or ORG_OG_CACHE_TTL_MS=0
// disables the memory cache (single-flight still applies). Errors/404s are never cached.
const ogRenderCache = new TtlCache<{ buffer: Buffer; etag: string }>({ maxEntries: 50 });

function ogMemoryTtlMs(): number {
  if (parseTtlMs(process.env.ORG_CACHE_TTL_MS, 1) === 0) return 0;

  return parseTtlMs(process.env.ORG_OG_CACHE_TTL_MS, 5 * 60 * 1000);
}

/** Drop the in-memory OG renders (tests / operational use). */
export function clearOrgSiteOgMemoryCache(): void {
  ogRenderCache.clear();
}

export function generateOrgSiteOgImage(siteName: string): Promise<{ buffer: Buffer; etag: string }> {
  return ogRenderCache.getOrLoad(
    siteName,
    () => renderOrgSiteOgImage(siteName),
    () => ogMemoryTtlMs()
  );
}

async function renderOrgSiteOgImage(siteName: string): Promise<{ buffer: Buffer; etag: string }> {
  const organization = await getOrganizationBySiteName(siteName);
  if (!organization) {
    throw new AppError('Organization not found', ErrorCodes.ORGANIZATION_NOT_FOUND, 404);
  }

  const activePlan = await getActiveOrganizationPlan(organization.id);
  const isFreePlan = isOrgOnFreePlan({
    plans: activePlan ? [{ planName: activePlan.planName, isActive: activePlan.isActive }] : [],
    isSelfHosted,
    orgId: organization.id
  });

  const tagline = isFreePlan ? undefined : extractOrgTagline(organization.landingpage);
  const themeColor = resolveThemeColor(organization.theme) ?? '#1d4ed8';
  const renderInput = {
    orgName: organization.name,
    logoUrl: organization.avatarUrl?.trim() || undefined,
    tagline,
    themeColor,
    showWatermark: isFreePlan
  };

  const etag = buildOrgSiteOgEtag({
    siteName,
    ...renderInput
  });

  const cachedBuffer = await getCachedOrgSiteOgBuffer(siteName, etag);
  if (cachedBuffer) {
    return { buffer: cachedBuffer, etag };
  }

  const { html, styles } = renderOrgSiteOg(renderInput);
  const buffer = await getCloudflarePngBuffer(html, styles, OG_VIEWPORT);

  await persistOrgSiteOgImage(siteName, buffer, etag);

  return { buffer, etag };
}
