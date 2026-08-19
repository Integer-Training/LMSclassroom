import 'dotenv/config';

import bcrypt from 'bcrypt';
import { ROLE, MEMBER_STATUS } from '@cio/utils/constants/roles';
import { db } from '../drizzle';
import {
  account,
  course,
  courseworkSubmission,
  group,
  groupmember,
  lesson,
  organization,
  organizationmember,
  profile,
  tutorAllocation,
  user
} from '../schema';
import { and, eq, like } from 'drizzle-orm';

/**
 * PearlLMS Phase-10 Step-6 (VOL-1) — seed a SCRATCH database with a few hundred learners + tutors +
 * allocations + enrolments + coursework submissions, to sanity-check that caseload, reports and the course
 * outline load acceptably at volume. Records nothing to production.
 *
 *   SEED_VOLUME_CONFIRM=SCRATCH pnpm --filter @cio/db exec tsx src/scripts/seed-volume.ts            # seed
 *   SEED_VOLUME_CONFIRM=SCRATCH pnpm --filter @cio/db exec tsx src/scripts/seed-volume.ts --cleanup  # remove
 *
 * SAFETY: refuses to run unless SEED_VOLUME_CONFIRM=SCRATCH, so it can never be pointed at production by
 * accident. All rows carry the `volseed` marker (deterministic ids `f2xxxxxx…`, emails `volseed+N@scratch.local`)
 * so `--cleanup` removes exactly what it created and nothing else. Point DATABASE_URL at the scratch project.
 */

const CONFIRM = process.env.SEED_VOLUME_CONFIRM;
const LEARNERS = Number(process.env.VOLUME_LEARNERS ?? 300);
const TUTORS = Number(process.env.VOLUME_TUTORS ?? 12);
const CLEANUP = process.argv.includes('--cleanup');

const LEARNER_ID = (i: number) => `f2000000-0000-4000-b000-${String(i).padStart(12, '0')}`;
const TUTOR_ID = (i: number) => `f2000000-0000-4000-c000-${String(i).padStart(12, '0')}`;
const LEARNER_EMAIL = (i: number) => `volseed+l${i}@scratch.local`;
const TUTOR_EMAIL = (i: number) => `volseed+t${i}@scratch.local`;
const MARKER = 'volseed+%@scratch.local';

function assertScratch() {
  if (CONFIRM !== 'SCRATCH') {
    console.error(
      'REFUSING TO RUN. Set SEED_VOLUME_CONFIRM=SCRATCH and point DATABASE_URL at a SCRATCH project (never production).'
    );
    process.exit(1);
  }
}

async function cleanup() {
  console.log('Cleaning up volseed rows…');
  // Collect volseed profile ids, then delete dependents first (no FKs on some, but keep order sane).
  const profiles = await db.select({ id: profile.id }).from(profile).where(like(profile.email, MARKER));
  const ids = profiles.map((p) => p.id);
  if (ids.length === 0) {
    console.log('Nothing to clean.');
    process.exit(0);
  }
  for (const id of ids) {
    await db.delete(courseworkSubmission).where(eq(courseworkSubmission.learnerId, id));
    await db.delete(tutorAllocation).where(eq(tutorAllocation.learnerId, id));
    await db.delete(tutorAllocation).where(eq(tutorAllocation.tutorId, id));
    await db.delete(groupmember).where(eq(groupmember.profileId, id));
    await db.delete(organizationmember).where(eq(organizationmember.profileId, id));
    await db.delete(profile).where(eq(profile.id, id));
    await db.delete(account).where(eq(account.userId, id));
    await db.delete(user).where(eq(user.id, id));
  }
  console.log(`✅ Removed ${ids.length} volseed profiles + their members/allocations/enrolments/submissions.`);
  process.exit(0);
}

async function upsertPerson(id: string, email: string, name: string, roleId: number, orgId: string, hash: string) {
  await db
    .insert(user)
    .values({ id, name, email, emailVerified: true, banned: false, isAnonymous: false })
    .onConflictDoNothing();
  await db
    .insert(account)
    .values({ userId: id, providerId: 'credential', accountId: id, password: hash })
    .onConflictDoNothing();
  await db
    .insert(profile)
    .values({ id, fullname: name, username: `volseed-${id.slice(-6)}`, email, status: MEMBER_STATUS.ACTIVE })
    .onConflictDoNothing();
  const existing = await db
    .select({ id: organizationmember.id })
    .from(organizationmember)
    .where(and(eq(organizationmember.profileId, id), eq(organizationmember.organizationId, orgId)))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(organizationmember).values({ organizationId: orgId, roleId, profileId: id, email, verified: true });
  }
}

async function main() {
  assertScratch();
  if (CLEANUP) return cleanup();

  const started = Date.now();
  const [org] = await db.select({ id: organization.id }).from(organization).limit(1);
  if (!org) {
    console.error('No organization exists — run db:setup first.');
    process.exit(1);
  }
  // Pick the first course + its group + first lesson to enrol learners into and hang submissions on.
  const [courseRow] = await db.select({ id: course.id, groupId: course.groupId }).from(course).limit(1);
  const [lessonRow] = courseRow
    ? await db.select({ id: lesson.id }).from(lesson).where(eq(lesson.courseId, courseRow.id)).limit(1)
    : [undefined];

  const hash = await bcrypt.hash('VolSeed!2026', 10);

  console.log(`Seeding ${TUTORS} tutors + ${LEARNERS} learners into org ${org.id}…`);
  const tutorIds: string[] = [];
  for (let i = 1; i <= TUTORS; i++) {
    const id = TUTOR_ID(i);
    tutorIds.push(id);
    await upsertPerson(id, TUTOR_EMAIL(i), `VolSeed Tutor ${i}`, ROLE.TUTOR, org.id, hash);
  }

  for (let i = 1; i <= LEARNERS; i++) {
    const id = LEARNER_ID(i);
    await upsertPerson(id, LEARNER_EMAIL(i), `VolSeed Learner ${i}`, ROLE.LEARNER, org.id, hash);

    // Allocate each learner to a tutor (round-robin) — drives the caseload view.
    const tutorId = tutorIds[i % tutorIds.length];
    await db.insert(tutorAllocation).values({ organizationId: org.id, tutorId, learnerId: id }).onConflictDoNothing();

    // Enrol into the course group (roleId 3 = student) — drives outline + reports.
    if (courseRow?.groupId) {
      const enrolled = await db
        .select({ id: groupmember.id })
        .from(groupmember)
        .where(and(eq(groupmember.groupId, courseRow.groupId), eq(groupmember.profileId, id)))
        .limit(1);
      if (enrolled.length === 0) {
        await db.insert(groupmember).values({ groupId: courseRow.groupId, roleId: 3, profileId: id });
      }
    }

    // A submission for ~1 in 3 learners — drives submission/marking load.
    if (courseRow && lessonRow && i % 3 === 0) {
      await db
        .insert(courseworkSubmission)
        .values({
          learnerId: id,
          courseId: courseRow.id,
          lessonId: lessonRow.id,
          version: 1,
          files: [{ key: `coursework/${courseRow.id}/${id}/${lessonRow.id}/1/volseed.docx`, name: 'volseed.docx' }],
          status: 'submitted'
        })
        .onConflictDoNothing();
    }

    if (i % 50 === 0) console.log(`  …${i}/${LEARNERS} learners`);
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `✅ Seeded ${TUTORS} tutors + ${LEARNERS} learners (+ allocations, enrolments, ~${Math.floor(LEARNERS / 3)} submissions) in ${secs}s.`
  );
  console.log('Now measure: caseload load, reports, course outline. Then run with --cleanup to remove.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Volume seed failed:', e);
  process.exit(1);
});
