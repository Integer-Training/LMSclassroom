import 'dotenv/config';

import bcrypt from 'bcrypt';
import { ROLE, MEMBER_STATUS } from '@cio/utils/constants/roles';
import { db } from '../drizzle';
import { account, organization, organizationmember, profile, user } from '../schema';
import { eq } from 'drizzle-orm';

// Phase 1 fixtures: one clearly-fake user per role, for access-control tests + the manual
// login check. Idempotent (fixed ids, upsert). Password below is a dev fixture only.
//
//   pnpm --filter @cio/db seed:fixtures

const FIXTURE_PASSWORD = 'FixturePass!2026';

const FIXTURES = [
  { key: 'admin', id: 'f1000000-0000-4000-a000-000000000001', roleId: ROLE.ADMIN, name: 'Fixture Admin' },
  { key: 'manager', id: 'f1000000-0000-4000-a000-000000000002', roleId: ROLE.MANAGER, name: 'Fixture Manager' },
  { key: 'tutor', id: 'f1000000-0000-4000-a000-000000000003', roleId: ROLE.TUTOR, name: 'Fixture Tutor' },
  { key: 'learner', id: 'f1000000-0000-4000-a000-000000000004', roleId: ROLE.LEARNER, name: 'Fixture Learner' }
] as const;

async function main() {
  const [org] = await db.select({ id: organization.id }).from(organization).limit(1);
  if (!org) {
    console.error('No organization exists — run db:setup / create an org first.');
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(FIXTURE_PASSWORD, 10);

  for (const f of FIXTURES) {
    const email = `${f.key}@pearl.fixture`;

    await db
      .insert(user)
      .values({
        id: f.id,
        name: f.name,
        email,
        emailVerified: true,
        image: null,
        role: null,
        banned: false,
        isAnonymous: false
      })
      .onConflictDoNothing();

    await db
      .insert(account)
      .values({
        userId: f.id,
        providerId: 'credential',
        accountId: f.id,
        password: passwordHash
      })
      .onConflictDoNothing();

    await db
      .insert(profile)
      .values({
        id: f.id,
        fullname: f.name,
        username: `fixture-${f.key}`,
        email,
        status: MEMBER_STATUS.ACTIVE
      })
      .onConflictDoNothing();
    // Keep status/role correct even if the row already existed.
    await db.update(profile).set({ status: MEMBER_STATUS.ACTIVE }).where(eq(profile.id, f.id));

    const existing = await db
      .select({ id: organizationmember.id })
      .from(organizationmember)
      .where(eq(organizationmember.profileId, f.id))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(organizationmember).values({
        organizationId: org.id,
        roleId: f.roleId,
        profileId: f.id,
        email,
        verified: true
      });
    } else {
      await db.update(organizationmember).set({ roleId: f.roleId }).where(eq(organizationmember.profileId, f.id));
    }

    console.log(`   ✓ fixture ${f.key} (${email}) role=${f.roleId} status=ACTIVE`);
  }

  console.log(`✅ Seeded ${FIXTURES.length} role fixtures (password: ${FIXTURE_PASSWORD}). Org ${org.id}.`);
  process.exit(0);
}

main().catch(async (e) => {
  console.error('Fixture seed failed:', e);
  process.exit(1);
});
