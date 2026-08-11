import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLicenseStatus, isFeatureLicensed, isFeatureLicensedSync } from '@api/services/license';
import { LICENSE_FEATURE } from '@cio/utils/license';

// Privacy regression guard (PearlLMS fork): the vendor build POSTed to
// enterprise-api.classroomio.dev to verify a license key. That phone-home was
// removed outright. These tests fail if any license call reaches the network or
// if the "all features licensed" posture regresses.

describe('license service — no vendor phone-home', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never makes a network request when resolving license status', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const status = await getLicenseStatus();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(status.valid).toBe(true);
    // Every known feature is licensed in this fork.
    for (const feature of Object.values(LICENSE_FEATURE)) {
      expect(status.features).toContain(feature);
    }
  });

  it('licenses every feature without a network call (async + sync)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(isFeatureLicensed(LICENSE_FEATURE.SSO)).resolves.toBe(true);
    await expect(isFeatureLicensed(LICENSE_FEATURE.NO_TRACKING)).resolves.toBe(true);
    expect(isFeatureLicensedSync(LICENSE_FEATURE.TOKEN_AUTH)).toBe(true);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
