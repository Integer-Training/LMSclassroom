import type { AccountOrg } from '$features/app/types';
import type { MetaTagsProps } from 'svelte-meta-tags';
import type { UploadLimits } from '$lib/utils/config/upload-limits';
import { getBaseMetaTags } from '$lib/utils/functions/metaTags.server';
import { getOrgSiteInfo } from '$features/app/layout-setup';
import { getUploadLimits } from '$lib/utils/config/upload-limits';
import { toPublicLocals, type PublicLocals } from '$lib/utils/services/auth/public-locals';

export const ssr = true;

interface LoadOutput {
  orgSiteName: string;
  isOrgSite: boolean;
  skipAuth: boolean;
  org: AccountOrg | null;
  baseMetaTags: MetaTagsProps;
  serverLang: string;
  localeCookie: string;
  locals: PublicLocals;
  uploadLimits: UploadLimits;
}

export const load = async ({ url, cookies, request, locals, untrack }): Promise<LoadOutput> => {
  const debugPlay = cookies.get('debugPlay');

  const orgSiteInfo = await getOrgSiteInfo(url, cookies);

  const response: LoadOutput = {
    orgSiteName: orgSiteInfo.orgSiteName,
    isOrgSite: orgSiteInfo.isOrgSite,
    skipAuth: orgSiteInfo.subdomain === 'play' || debugPlay === 'true',
    org: orgSiteInfo.org,
    baseMetaTags: await getBaseMetaTags(url, orgSiteInfo, untrack),
    serverLang: request.headers?.get('accept-language') || '',
    localeCookie: cookies.get('classroomio_locale') || '',
    // Only what the client uses (user, locale, orgRoles, status, actor): never the session token / IP / user agent.
    locals: toPublicLocals(locals),
    uploadLimits: getUploadLimits()
  };

  // If it isn't a registered dashboard domain and also not a valid sub domain.
  // if (!APP_SUBDOMAINS.includes(orgSiteInfo.subdomain) && !dev && !orgSiteInfo.isOrgSite) {
  //   redirect(307, 'https://app.classroomio.com');
  // }

  return response;
};
