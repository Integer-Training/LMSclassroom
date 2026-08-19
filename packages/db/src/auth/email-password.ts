import * as schema from '@db/schema';
import bcrypt from 'bcrypt';

import { db, eq } from '@db/drizzle';
import { type BetterAuthOptions } from 'better-auth';
import { sendEmail } from '@cio/email';

/**
 * Configuration for the email and password options
 * @see https://www.better-auth.com/docs/authentication/email-password
 */
export const config: BetterAuthOptions['emailAndPassword'] = {
  enabled: true,
  // PearlLMS is a closed system — accounts are created ONLY by staff provisioning (Better Auth
  // admin.createUser, which is unaffected by this flag). disableSignUp kills the public
  // POST /api/auth/sign-up/email endpoint while leaving sign-in, forgot/reset-password, email
  // verification and change-email fully working for already-provisioned users.
  disableSignUp: true,
  // PearlLMS Phase-10 HP/SW-13 — explicit password policy. Better-auth's default minimum is 8; learner/staff
  // accounts hold PII, so require >= 10 characters. Cap at 128 to bound bcrypt hashing cost (a very long input
  // is an easy CPU-DoS vector). Enforced on every password set (invite set-password + self-service reset).
  minPasswordLength: 10,
  maxPasswordLength: 128,
  // Phase-10 O2 — password-reset link valid for 1 hour (explicit; matches the better-auth default we rely on).
  resetPasswordTokenExpiresIn: 60 * 60,
  password: {
    hash: async (password) => {
      return await bcrypt.hash(password, 10);
    },
    verify: async ({ hash, password }) => {
      return await bcrypt.compare(password, hash);
    }
  },
  sendResetPassword: sendResetPassword,
  onPasswordReset: onPasswordReset
};

/**
 * Types for the email and password options
 */
type ResetPasswordOptions = Parameters<
  NonNullable<NonNullable<BetterAuthOptions['emailAndPassword']>['sendResetPassword']>
>[0];
type OnPasswordResetEmail = Parameters<
  NonNullable<NonNullable<BetterAuthOptions['emailAndPassword']>['onPasswordReset']>
>[0];

async function sendResetPassword(options: ResetPasswordOptions) {
  const { user, url } = options;

  const [profile] = await db.select().from(schema.profile).where(eq(schema.profile.id, user.id)).limit(1);
  if (!profile) {
    throw new Error('Profile not found');
  }

  await sendEmail('forgotPassword', {
    to: user.email,
    fields: {
      name: profile.fullname,
      email: user.email,
      link: url
    }
  });
}

async function onPasswordReset(options: OnPasswordResetEmail) {
  const { user } = options;

  const [profile] = await db.select().from(schema.profile).where(eq(schema.profile.id, user.id)).limit(1);
  if (!profile) {
    throw new Error('Profile not found');
  }

  await sendEmail('onPasswordReset', {
    to: user.email,
    fields: {
      name: profile.fullname
    }
  });
}
