import {
  resolveEmailDelivery,
  type EmailNotificationSettings,
  type PersonalEmailNotificationSettings
} from '@cio/utils/notifications';

import { getOrganizationEmailNotificationSettings } from './email-preferences-org';
import {
  getPersonalEmailNotificationSettingsForOrg,
  getPersonalEmailNotificationSettingsForOrgBatch
} from './organizationmember-email-notifications';
import { getProfileByEmail } from '../auth/profile';
import type { EmailId } from '@cio/email';

export async function shouldSendEmail(input: {
  emailId: EmailId;
  organizationId?: string;
  recipientEmail?: string;
  recipientProfileId?: string;
}): Promise<boolean> {
  return new EmailPreferenceLookupCache().shouldSend(input);
}

/**
 * Reuses org/profile settings lookups across many recipients in batch processors.
 */
export class EmailPreferenceLookupCache {
  private orgSettingsById = new Map<string, EmailNotificationSettings | undefined>();
  private personalSettingsByOrgMember = new Map<string, PersonalEmailNotificationSettings | undefined>();
  private profileIdByEmail = new Map<string, string | undefined>();

  async shouldSend(input: {
    emailId: EmailId;
    organizationId?: string;
    recipientEmail?: string;
    recipientProfileId?: string;
  }): Promise<boolean> {
    const orgSettings = input.organizationId ? await this.getOrganizationSettings(input.organizationId) : undefined;

    let profileId = input.recipientProfileId;

    if (!profileId && input.recipientEmail) {
      profileId = await this.getProfileIdByEmail(input.recipientEmail);
    }

    const personalSettings =
      profileId && input.organizationId ? await this.getPersonalSettings(profileId, input.organizationId) : undefined;

    return resolveEmailDelivery(input.emailId, orgSettings, personalSettings);
  }

  /**
   * Optional warm-up for a batch processor: load the personal settings of many recipients of one org in a single
   * query instead of two per recipient. Purely read batching: the values cached are exactly what the lazy
   * per-recipient lookup would have produced, so delivery decisions are unchanged.
   */
  async prefetchPersonalSettings(profileIds: string[], organizationId: string): Promise<void> {
    const missing = profileIds.filter((id) => !this.personalSettingsByOrgMember.has(`${id}:${organizationId}`));
    if (missing.length === 0) return;

    const settingsByProfile = await getPersonalEmailNotificationSettingsForOrgBatch(missing, organizationId);
    for (const [profileId, settings] of settingsByProfile) {
      this.personalSettingsByOrgMember.set(`${profileId}:${organizationId}`, settings);
    }
  }

  private async getOrganizationSettings(orgId: string): Promise<EmailNotificationSettings | undefined> {
    if (!this.orgSettingsById.has(orgId)) {
      const settings = await getOrganizationEmailNotificationSettings(orgId);
      this.orgSettingsById.set(orgId, settings);
    }

    return this.orgSettingsById.get(orgId);
  }

  private async getProfileIdByEmail(email: string): Promise<string | undefined> {
    if (!this.profileIdByEmail.has(email)) {
      const profile = await getProfileByEmail(email);
      this.profileIdByEmail.set(email, profile?.id);
    }

    return this.profileIdByEmail.get(email);
  }

  private async getPersonalSettings(
    profileId: string,
    organizationId: string
  ): Promise<PersonalEmailNotificationSettings | undefined> {
    const cacheKey = `${profileId}:${organizationId}`;

    if (!this.personalSettingsByOrgMember.has(cacheKey)) {
      const settings = await getPersonalEmailNotificationSettingsForOrg(profileId, organizationId);
      this.personalSettingsByOrgMember.set(cacheKey, settings);
    }

    return this.personalSettingsByOrgMember.get(cacheKey);
  }
}
