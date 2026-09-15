import * as schema from '@db/schema';

import { and, db, eq, type DbOrTxClient } from '@db/drizzle';

// Admin Learner-/Tutor-management member lists. Org-scoped (organizationmember roleId), NOT allocation-scoped,
// so they cover EVERY learner/tutor in the org. Each row carries the org `memberId` the action endpoints
// (suspend, login-as, reset password, edit PII) key on, plus name/email/status.

export interface OrgMemberRow {
  memberId: number;
  userId: string;
  name: string | null;
  email: string | null;
  status: string;
}

const ROLE_STUDENT = 3;
const ROLE_TUTOR = 2;

async function listOrgMembersByRole(orgId: string, roleId: number, client: DbOrTxClient): Promise<OrgMemberRow[]> {
  const rows = await client
    .select({
      memberId: schema.organizationmember.id,
      userId: schema.profile.id,
      name: schema.profile.fullname,
      email: schema.profile.email,
      status: schema.profile.status
    })
    .from(schema.organizationmember)
    .innerJoin(schema.profile, eq(schema.profile.id, schema.organizationmember.profileId))
    .where(and(eq(schema.organizationmember.organizationId, orgId), eq(schema.organizationmember.roleId, roleId)))
    .orderBy(schema.profile.fullname);
  return rows.map((r) => ({ ...r, memberId: Number(r.memberId) })) as OrgMemberRow[];
}

/** Every STUDENT org member with their org memberId + status. */
export function listOrgLearnerMembers(orgId: string, client: DbOrTxClient = db): Promise<OrgMemberRow[]> {
  return listOrgMembersByRole(orgId, ROLE_STUDENT, client);
}

/** Every TUTOR org member with their org memberId + status. */
export function listOrgTutorMembersFull(orgId: string, client: DbOrTxClient = db): Promise<OrgMemberRow[]> {
  return listOrgMembersByRole(orgId, ROLE_TUTOR, client);
}
