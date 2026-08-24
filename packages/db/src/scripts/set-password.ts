import 'dotenv/config';

import bcrypt from 'bcrypt';
import { db } from '../drizzle';
import { account, user } from '../schema';
import { and, eq } from 'drizzle-orm';

/**
 * PearlLMS — set (reset) an EXISTING user's password directly in the database.
 *
 * Safety net for the "email is off" period (before AWS SES is wired): the app's normal password-reset needs
 * email, and public sign-up is closed, so this guarantees an admin can always get a working login. It ONLY
 * resets the password of a user that already exists — it never creates accounts (provision those properly via
 * the admin Users screen).
 *
 *   SET_PW_EMAIL="admin@yourorg.com" SET_PW_PASSWORD="a-strong-password" \
 *     pnpm --filter @cio/db exec tsx src/scripts/set-password.ts
 *
 * Point DATABASE_URL at the live Supabase. The password is never logged.
 */

const email = (process.env.SET_PW_EMAIL ?? '').trim().toLowerCase();
const password = process.env.SET_PW_PASSWORD ?? '';

async function main() {
  if (!email || !password) {
    console.error('Usage: SET_PW_EMAIL=… SET_PW_PASSWORD=… tsx src/scripts/set-password.ts');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('Refusing: password must be at least 10 characters (matches the app policy).');
    process.exit(1);
  }

  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  if (!u) {
    console.error(
      `No user found with email ${email}. This resets EXISTING users only — provision new ones via the admin Users screen.`
    );
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // Update the existing credential row if there is one; otherwise create it. (No blind upsert — that could leave
  // a duplicate credential account, which better-auth would not expect.)
  const [existing] = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, u.id), eq(account.providerId, 'credential')))
    .limit(1);

  if (existing) {
    await db.update(account).set({ password: passwordHash }).where(eq(account.id, existing.id));
  } else {
    await db
      .insert(account)
      .values({ userId: u.id, providerId: 'credential', accountId: u.id, password: passwordHash });
  }

  console.log(`✅ Password set for ${email}. You can now log in with the new password. (Password not logged.)`);
  process.exit(0);
}

main().catch((e) => {
  console.error('set-password failed:', e);
  process.exit(1);
});
