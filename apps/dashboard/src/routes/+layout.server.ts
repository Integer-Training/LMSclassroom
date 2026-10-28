import type { AccountOrg } from '$features/app/types';
import type { MetaTagsProps } from 'svelte-meta-tags';
import type { UploadLimits } from '$lib/utils/config/upload-limits';
import { PUBLIC_IS_SELFHOSTED } from '$env/static/public';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { getBaseMetaTags } from '$lib/utils/functions/metaTags.server';
import { getOrgSiteInfo } from '$features/app/layout-setup';
import { getUploadLimits } from '$lib/utils/config/upload-limits';
import { resolveOrgSiteOgWarmUrl } from '$lib/utils/functions/org-site-og-url';

export const ssr = true;

interface LoadOutput {
  orgSiteName: string;
  isOrgSite: boolean;
  skipAuth: boolean;
  org: AccountOrg | null;
  baseMetaTags: MetaTagsProps;
  serverLang: string;
  localeCookie: string;
  locals: App.Locals;
  uploadLimits: UploadLimits;
}

export const load = async ({ url, cookies, request, locals }): Promise<LoadOutput> => {
  const debugPlay = cookies.get('debugPlay');

  const orgSiteInfo = await getOrgSiteInfo(url, cookies);

  if (orgSiteInfo.isOrgSite && orgSiteInfo.org?.siteName) {
    const warmUrl = resolveOrgSiteOgWarmUrl({
      siteName: orgSiteInfo.org.siteName,
      isSelfHosted: PUBLIC_IS_SELFHOSTED === 'true',
      privateServerUrl: env.PRIVATE_SERVER_URL,
      publicServerUrl: publicEnv.PUBLIC_SERVER_URL
    });

    if (warmUrl) {
      void fetch(warmUrl)
        .then((response) => response.body?.cancel())
        .catch(() => {});
    }
  }

  const response: LoadOutput = {
    orgSiteName: orgSiteInfo.orgSiteName,
    isOrgSite: orgSiteInfo.isOrgSite,
    skipAuth: orgSiteInfo.subdomain === 'play' || debugPlay === 'true',
    org: orgSiteInfo.org,
    baseMetaTags: await getBaseMetaTags(url, orgSiteInfo),
    serverLang: request.headers?.get('accept-language') || '',
    localeCookie: cookies.get('classroomio_locale') || '',
    locals,
    uploadLimits: getUploadLimits()
  };

  // If it isn't a registered dashboard domain and also not a valid sub domain.
  // if (!APP_SUBDOMAINS.includes(orgSiteInfo.subdomain) && !dev && !orgSiteInfo.isOrgSite) {
  //   redirect(307, 'https://app.classroomio.com');
  // }

  return response;
};
