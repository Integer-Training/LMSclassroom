import { LICENSE_FEATURE, type LicenseFeatureId } from '@cio/utils/license';

export type LicenseStatus = {
  valid: boolean;
  features: string[];
  expiresAt?: string;
};

/** All available license features. */
const ALL_FEATURES = Object.values(LICENSE_FEATURE);

/**
 * License status.
 *
 * The vendor build POSTed to https://enterprise-api.classroomio.dev to verify a
 * license key. That phone-home has been removed for privacy (PearlLMS fork): this
 * is a self-owned hard fork with no external license server, so every feature is
 * licensed and no network call is ever made. Kept as a function (not a constant)
 * so the async call-sites are unchanged.
 */
export async function getLicenseStatus(): Promise<LicenseStatus> {
  return { valid: true, features: ALL_FEATURES };
}

/**
 * Checks if a specific feature is licensed. All features are licensed in this fork.
 * @param feature - Feature ID from LICENSE_FEATURE
 */
export async function isFeatureLicensed(_feature: LicenseFeatureId | string): Promise<boolean> {
  return true;
}

/**
 * Synchronous feature check. All features are licensed in this fork.
 * @param feature - Feature ID from LICENSE_FEATURE
 */
export function isFeatureLicensedSync(_feature: LicenseFeatureId | string): boolean {
  return true;
}
