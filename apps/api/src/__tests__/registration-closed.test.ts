import { beforeEach, describe, expect, it, vi } from 'vitest';

// PearlLMS is a closed system: no public org self-onboarding. Both POST /organization and
// POST /onboarding/create-org funnel through createOrganizationWithOwner, which must refuse on a
// self-hosted instance once the singleton org exists. Heavy deps are mocked so we exercise only the
// refusal branch (the Better Auth sign-up disable + endpoint denials are proven by the live matrix).

vi.mock('@cio/core/config/env', () => ({ env: { PUBLIC_IS_SELFHOSTED: 'true' } }));
vi.mock('@cio/db/drizzle', () => ({ db: { transaction: vi.fn() } }));
vi.mock('@api/services/jobs', () => ({ enqueueTransactionalEmail: vi.fn() }));
vi.mock('@cio/db/queries/auth', () => ({ getProfileById: vi.fn(), updateProfile: vi.fn() }));
vi.mock('@cio/db/queries', () => ({
  getOrganizationCount: vi.fn(async () => 1),
  checkSiteNameExists: vi.fn(async () => false),
  createOrganization: vi.fn(),
  createOrganizationMember: vi.fn(),
  createOrganizationPlan: vi.fn(),
  getOrganizationByProfileId: vi.fn(async () => [])
}));

import { getOrganizationCount } from '@cio/db/queries';
import { createOrganizationWithOwner } from '@api/services/onboarding';

describe('closed system — org self-onboarding is refused on self-hosted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws 403 when the singleton org already exists', async () => {
    vi.mocked(getOrganizationCount).mockResolvedValue(1);

    await expect(
      createOrganizationWithOwner('profile-1', { orgName: 'Intruder Academy', siteName: 'intruder' })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('does not create anything when refused (no site-name lookup, no transaction)', async () => {
    const queries = await import('@cio/db/queries');
    vi.mocked(getOrganizationCount).mockResolvedValue(1);

    await expect(createOrganizationWithOwner('profile-1', { orgName: 'X', siteName: 'x' })).rejects.toMatchObject({
      statusCode: 403
    });

    expect(queries.checkSiteNameExists).not.toHaveBeenCalled();
    expect(queries.createOrganization).not.toHaveBeenCalled();
    expect(queries.createOrganizationMember).not.toHaveBeenCalled();
  });
});
