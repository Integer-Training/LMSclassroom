import { PUBLIC_IS_SELFHOSTED } from '$env/static/public';
import { env } from '$env/dynamic/private';
import { getApiKeyHeaders } from '$lib/utils/services/api/server';
import { getOrgBySiteName } from '$features/org/api/org.server';
import { getSubdomain } from '$features/app/layout-setup';
import { redirect } from '@sveltejs/kit';
import { requireAdmin, requireSameOrg } from '$lib/server/guards';

const APP_SUBDOMAINS = env.PRIVATE_APP_SUBDOMAINS?.split(',') || ['app'];
const ORG_ID_COOKIE_PREFIX = 'cio_org_id_';

export const load = async ({ params, url, cookies, locals }) => {
  const loadStart = performance.now();
  const subdomain = getSubdomain(url);
  const isOrgSite = subdomain && !APP_SUBDOMAINS.includes(subdomain);

  // If this is LMS but user is on org site, redirect to LMS
  if (isOrgSite && PUBLIC_IS_SELFHOSTED !== 'true') {
    console.log('isOrgSite redirecting to lms');
    redirect(307, `/lms`);
  }

  // The entire org admin surface (dashboard, settings/*, audience, courses, cohorts, media, …) is
  // ADMIN-only. settings/* has no server load of its own, so this single layout guard is what stops
  // the admin shell rendering for tutors/learners (ACCESS.md dashboard gap). Enforced server-side —
  // the client nav hiding is only a courtesy.
  requireAdmin(locals);

  const siteName = params.slug;
  const cookieKey = `${ORG_ID_COOKIE_PREFIX}${siteName}`;
  const cachedOrgId = cookies.get(cookieKey);

  let orgId: string | undefined = cachedOrgId;
  let orgLookupMs = 0;

  if (!orgId) {
    const orgLookupStart = performance.now();
    const apiKeyHeaders = getApiKeyHeaders();
    const org = await getOrgBySiteName(siteName, apiKeyHeaders);
    orgLookupMs = Math.round((performance.now() - orgLookupStart) * 100) / 100;

    if (org?.id) {
      orgId = org.id;

      cookies.set(cookieKey, org.id, {
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // 7 days
        sameSite: 'lax',
        httpOnly: false // Allow client-side access if needed
      });
    }
  }

  // Bind the slug-resolved org to the caller's own org — an admin of org A cannot drive org B by
  // guessing the slug (closes the slug-trust gap). Single-org today, but correct for multi-tenant.
  requireSameOrg(locals, orgId);

  const loadMs = Math.round((performance.now() - loadStart) * 100) / 100;
  console.log(
    `[org/+layout.server] load: ${loadMs}ms | siteName=${siteName} orgIdCache=${cachedOrgId ? 'hit' : 'miss'} getOrgBySiteName: ${orgLookupMs}ms`
  );

  return {
    orgName: siteName,
    orgId
  };
};
