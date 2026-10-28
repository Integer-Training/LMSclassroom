import {
  preloadVerifiedCustomDomainOrigins,
  resolveTrustedBrowserOrigin,
  trustCustomDomainHostname,
  untrustCustomDomainHostname
} from '@cio/db/utils';

import { TRUSTED_ORIGINS } from '@api/constants';

const staticTrustedOriginEntries = TRUSTED_ORIGINS.map((entry) => entry.trim()).filter(Boolean) as readonly string[];

export async function preloadVerifiedCustomDomainOriginsRegistry(): Promise<void> {
  await preloadVerifiedCustomDomainOrigins();
}

export function resolveTrustedBrowserOriginForCors(origin: string): string | undefined {
  return resolveTrustedBrowserOrigin(origin, staticTrustedOriginEntries);
}

export { trustCustomDomainHostname, untrustCustomDomainHostname };
