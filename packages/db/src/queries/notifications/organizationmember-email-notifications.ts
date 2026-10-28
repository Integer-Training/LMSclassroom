import {
  DEFAULT_MEMBER_EMAIL_NOTIFICATION_ROW,
  memberEmailNotificationRowToApiResponse,
  memberEmailNotificationRowToPersonalSettings,
  personalSettingsToMemberEmailNotificationRow,
  type MemberEmailNotificationRow
} from '@cio/utils/notifications';
import type { PersonalEmailNotificationSettings } from '@cio/utils/notifications';
import type { TMemberEmailNotificationPreferencesUpdate } from '@cio/utils/validation/notifications';

import { getOrganizationMemberIdByOrgAndProfile } from '../organization/organization';
import { db } from '@db/drizzle';
import * as schema from '@db/schema';
import { and, eq, inArray } from 'drizzle-orm';

function rowFromRecord(
  record: typeof schema.organizationmemberEmailNotifications.$inferSelect | undefined
): MemberEmailNotificationRow | null {
  if (!record) {
    return null;
  }

  return {
    newStudent: record.newStudent,
    newSubmission: record.newSubmission,
    gradingResult: record.gradingResult,
    newsfeed: record.newsfeed,
    quizAssigned: record.quizAssigned,
    cohortReminder: record.cohortReminder,
    session: record.session,
    courseCompletion: record.courseCompletion
  };
}

async function getEmailNotificationsByMemberId(
  organizationMemberId: number
): Promise<MemberEmailNotificationRow | null> {
  const [record] = await db
    .select()
    .from(schema.organizationmemberEmailNotifications)
    .where(eq(schema.organizationmemberEmailNotifications.organizationMemberId, organizationMemberId))
    .limit(1);

  return rowFromRecord(record);
}

export async function getOrganizationMemberEmailNotifications(
  profileId: string,
  organizationId: string
): Promise<MemberEmailNotificationRow | null> {
  try {
    const organizationMemberId = await getOrganizationMemberIdByOrgAndProfile(organizationId, profileId);

    if (!organizationMemberId) {
      return null;
    }

    return getEmailNotificationsByMemberId(organizationMemberId);
  } catch (error) {
    console.error('getOrganizationMemberEmailNotifications error:', error);
    throw new Error('Failed to get organization member email notification preferences');
  }
}

/**
 * Batch form of getPersonalEmailNotificationSettingsForOrg for many profiles of ONE org: a single
 * organizationmember LEFT JOIN preferences query (chunked). Every requested profile id is present in the
 * result; a profile with no org membership or no preference row maps to exactly what the single lookup
 * returns for it (settings derived from a null row).
 */
export async function getPersonalEmailNotificationSettingsForOrgBatch(
  profileIds: string[],
  organizationId: string
): Promise<Map<string, PersonalEmailNotificationSettings | undefined>> {
  const result = new Map<string, PersonalEmailNotificationSettings | undefined>();
  const unique = [...new Set(profileIds)];
  const rowByProfile = new Map<string, MemberEmailNotificationRow | null>();

  for (let i = 0; i < unique.length; i += 500) {
    const rows = await db
      .select({
        profileId: schema.organizationmember.profileId,
        prefs: schema.organizationmemberEmailNotifications
      })
      .from(schema.organizationmember)
      .leftJoin(
        schema.organizationmemberEmailNotifications,
        eq(schema.organizationmemberEmailNotifications.organizationMemberId, schema.organizationmember.id)
      )
      .where(
        and(
          eq(schema.organizationmember.organizationId, organizationId),
          inArray(schema.organizationmember.profileId, unique.slice(i, i + 500))
        )
      );

    for (const row of rows) {
      if (row.profileId && !rowByProfile.has(row.profileId)) {
        rowByProfile.set(row.profileId, rowFromRecord(row.prefs ?? undefined));
      }
    }
  }

  for (const profileId of unique) {
    result.set(profileId, memberEmailNotificationRowToPersonalSettings(rowByProfile.get(profileId) ?? null));
  }
  return result;
}

export async function getOrganizationMemberEmailNotificationsForApi(profileId: string, organizationId: string) {
  const row = await getOrganizationMemberEmailNotifications(profileId, organizationId);

  return memberEmailNotificationRowToApiResponse(row);
}

export async function getPersonalEmailNotificationSettingsForOrg(
  profileId: string,
  organizationId: string
): Promise<PersonalEmailNotificationSettings | undefined> {
  const row = await getOrganizationMemberEmailNotifications(profileId, organizationId);

  return memberEmailNotificationRowToPersonalSettings(row);
}

export async function upsertOrganizationMemberEmailNotifications(
  profileId: string,
  organizationId: string,
  preferences: TMemberEmailNotificationPreferencesUpdate
): Promise<MemberEmailNotificationRow> {
  try {
    const organizationMemberId = await getOrganizationMemberIdByOrgAndProfile(organizationId, profileId);

    if (!organizationMemberId) {
      throw new Error('Organization member not found');
    }

    const existing = await getEmailNotificationsByMemberId(organizationMemberId);
    const merged = personalSettingsToMemberEmailNotificationRow({
      ...(existing ?? DEFAULT_MEMBER_EMAIL_NOTIFICATION_ROW),
      ...preferences
    });
    const updatedAt = new Date().toISOString();

    const [record] = await db
      .insert(schema.organizationmemberEmailNotifications)
      .values({
        organizationMemberId,
        ...merged,
        updatedAt
      })
      .onConflictDoUpdate({
        target: schema.organizationmemberEmailNotifications.organizationMemberId,
        set: {
          ...merged,
          updatedAt
        }
      })
      .returning();

    const row = rowFromRecord(record);

    if (!row) {
      throw new Error('Failed to upsert organization member email notification preferences');
    }

    return row;
  } catch (error) {
    if (error instanceof Error && error.message === 'Organization member not found') {
      throw error;
    }

    console.error('upsertOrganizationMemberEmailNotifications error:', error);
    throw new Error('Failed to update organization member email notification preferences');
  }
}
