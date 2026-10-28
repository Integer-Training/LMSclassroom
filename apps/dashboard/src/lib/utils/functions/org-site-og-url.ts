import { buildOrgSiteOgApiUrl, buildOrgSiteOgCdnUrl } from '@cio/utils/org-site/og-public-url';
import { TtlCache, parseTtlMs } from '@cio/utils/cache';

const DEFAULT_CLOUD_MEDIA_CDN_URL = 'https://img.cdn.clsrio.com';

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function isPublicHttpOrigin(value: string): boolean {
  if (!isValidHttpUrl(value)) {
    return false;
  }

  const host = new URL(value).hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return true;
  }

  return host.includes('.');
}

const CDN_HEAD_TIMEOUT_MS = 2000;
// The CDN HEAD ran on every page render. Remember the answer per CDN URL (hits AND misses) for 30 minutes so a missing
// object does not cost a 2s-timeout HEAD per navigation. ORG_CACHE_TTL_MS=0 (shared kill switch) disables it.
const CDN_HEAD_TTL_MS = 30 * 60 * 1000;
const cdnHeadCache = new TtlCache<boolean>({ maxEntries: 200 });

export function clearOrgSiteOgCdnCache(): void {
  cdnHeadCache.clear();
}

async function isOrgSiteOgCdnObjectAvailable(cdnUrl: string): Promise<boolean> {
  const ttl = parseTtlMs(process.env.ORG_CACHE_TTL_MS, 1) === 0 ? 0 : CDN_HEAD_TTL_MS;

  return cdnHeadCache.getOrLoad(
    cdnUrl,
    () => headOrgSiteOgCdnObject(cdnUrl),
    () => ttl
  );
}

async function headOrgSiteOgCdnObject(cdnUrl: string): Promise<boolean> {
  try {
    const response = await fetch(cdnUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(CDN_HEAD_TIMEOUT_MS)
    });

    return response.ok;
  } catch {
    return false;
  }
}

export async function resolveOrgSiteOgImageUrl(options: {
  siteName: string;
  pageOrigin: string;
  isSelfHosted: boolean;
  mediaCdnUrl?: string | null;
  publicServerUrl?: string | null;
}): Promise<string | null> {
  const siteName = options.siteName.trim();
  if (!siteName) {
    return null;
  }

  const mediaCdnUrl = options.mediaCdnUrl?.trim() || (!options.isSelfHosted ? DEFAULT_CLOUD_MEDIA_CDN_URL : '');
  if (mediaCdnUrl && isPublicHttpOrigin(mediaCdnUrl)) {
    const cdnUrl = buildOrgSiteOgCdnUrl(siteName, mediaCdnUrl);
    if (await isOrgSiteOgCdnObjectAvailable(cdnUrl)) {
      return cdnUrl;
    }
  }

  const publicServerUrl = options.publicServerUrl?.trim();
  if (publicServerUrl && isPublicHttpOrigin(publicServerUrl)) {
    return buildOrgSiteOgApiUrl(siteName, publicServerUrl);
  }

  return `${options.pageOrigin}/proxy/org-site/og/${encodeURIComponent(siteName)}.png`;
}
