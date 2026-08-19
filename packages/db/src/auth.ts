import * as CONSTANTS from './constants';
import * as schema from '@db/schema';

import { admin } from 'better-auth/plugins';
import { APIError } from 'better-auth/api';
import { sendChangeEmailConfirmation, sendVerificationEmail } from './auth/email-verification';

import { betterAuth } from 'better-auth/minimal';
import { createProfileHook } from './auth/hooks/create-profile';
import { customSession } from 'better-auth/plugins/custom-session';
import { db } from '@db/drizzle';
import { eq } from 'drizzle-orm';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { config as emailAndPassword } from './auth/email-password';
import { getUserOrgRolesMap } from './queries/organization/organization';
import { loginLink } from './auth/plugins/login-link';
import { oAuthProxy } from 'better-auth/plugins/oauth-proxy';
import { resolveTrustedBrowserOrigin } from './utils';
import { sso } from '@better-auth/sso';
import { syncUserWithProfile } from './auth/hooks/sync-user';
import { tokenExchange } from './auth/plugins/token-exchange';
import { trackLoginHook } from './auth/hooks/track-login';
import { syncProfileEmailVerificationFromAuthUser } from './queries/auth/profile';

export { mintLoginLinkToken } from './auth/login-link';

/**
 * Cloud (multi-tenant) only. Routes OAuth/SSO callbacks to the canonical
 * production URL while completing the flow on whichever tenant host the
 * user signed in from (<org>.myclassroomio.com or a BYOD domain).
 *
 * Self-hosted instances proxy browser auth through the dashboard origin, so
 * the OAuth proxy plugin is only needed for cloud tenant/BYOD domains.
 */
function buildOAuthProxyPlugin() {
  if (process.env.PUBLIC_IS_SELFHOSTED === 'true') {
    return [];
  }
  return [oAuthProxy({ productionURL: CONSTANTS.BASE_URL })];
}

/**
 * PearlLMS Phase 7 (docs/ONBOARDING-MODEL.md D5) — the two remaining plugins whose code paths can mint a
 * NET-NEW account for a stranger:
 *   - sso() JIT-creates a user on a real IdP login for a domain matching an ACTIVE organization_sso_config.
 *   - tokenExchange() calls signUpEmail for an unknown email when an ACTIVE organization_token_auth row exists.
 * Both are inert today (empty backing tables), but on a self-hosted closed system they should not be
 * enable-able merely by inserting a config row. We drop them entirely from the plugin list when self-hosted —
 * defense-in-depth on top of disableSignUp. (Cloud builds keep them.)
 */
function buildStrangerAccountPlugins() {
  if (process.env.PUBLIC_IS_SELFHOSTED === 'true') {
    return [];
  }
  return [
    sso({
      // OIDC providers are registered dynamically per organization
      // via the admin API (auth.api.registerSSOProvider)
    }),
    tokenExchange()
  ];
}

export const auth: ReturnType<typeof betterAuth> = betterAuth({
  baseURL: CONSTANTS.BASE_URL,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema
    // debugLogs: true
  }),
  emailAndPassword: emailAndPassword,
  user: {
    changeEmail: {
      enabled: true,
      sendChangeEmailConfirmation
    }
  },
  emailVerification: {
    enabled: true,
    // PearlLMS Phase-10 O2 — verification link valid 24h (better-auth default is 1h — too short for an emailed
    // learner action).
    expiresIn: 60 * 60 * 24, // 24 hours
    sendVerificationEmail
  },
  // Closed system: no social providers. Google OAuth auto-creates an account on first login, which
  // disableSignUp does NOT prevent — so the provider is removed entirely. (SSO/token-auth plugins
  // below remain for the enterprise route groups but are inert: no provider/secret is configured.)
  trustedOrigins: (request) => {
    const origins = [...CONSTANTS.TRUSTED_ORIGINS];
    const originHeader = request?.headers.get('origin');
    const resolved = resolveTrustedBrowserOrigin(originHeader, CONSTANTS.TRUSTED_ORIGINS);

    if (resolved && !origins.includes(resolved)) {
      origins.push(resolved);
    }

    return origins;
  },
  advanced: {
    cookiePrefix: 'classroomio',
    // Browser auth is first-party through tenant-router or the dashboard proxy,
    // so cookies should stay host-only on the dashboard/public-site origin.
    crossSubDomainCookies: { enabled: false },
    database: {
      generateId: false
    }
  },
  account: {
    storeAccountCookie: true
  },
  session: {
    // PearlLMS Phase-10 O1 — shortened from 30d to a 7-day rolling session (idle >7d → re-auth). Better-auth's
    // core session has ONE rolling window (expiresIn, refreshed at most every updateAge on activity), so the
    // owner-approved "24h idle timeout" is captured as this 7-day rolling idle; a separate short absolute-idle
    // cap on top of a longer max would need a custom max-session plugin (recorded as an optional follow-up).
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day (session expiry refreshed at most once/day on activity)
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60 // 1 hour
    }
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          console.log('[auth] databaseHooks.user.create.after: running', { userId: user.id });
          await createProfileHook(user);
        }
      },
      update: {
        after: async (user) => {
          console.log('[auth] databaseHooks.user.update.after: running', { userId: user.id });
          await syncUserWithProfile(user);
        }
      }
    },
    session: {
      create: {
        // Deactivation must block re-login (PearlLMS Phase 1 Step 7). This runs at the
        // session-creation seam — the same place the admin plugin rejects `banned` users — so a
        // DEACTIVATED profile cannot sign in. A live session is separately deleted at deactivation
        // time (deleteSessionsByUserId), so the effect is immediate; resolveActor denies too.
        before: async (session) => {
          try {
            const [row] = await db
              .select({ status: schema.profile.status })
              .from(schema.profile)
              .where(eq(schema.profile.id, session.userId))
              .limit(1);
            if (row?.status === 'DEACTIVATED') {
              throw new APIError('FORBIDDEN', {
                message: 'Your account has been deactivated. Contact an administrator.'
              });
            }
          } catch (error) {
            // Re-throw the deliberate deny; never block login on an incidental DB error.
            if (error instanceof APIError) throw error;
            console.error('[auth] session.create.before status check failed:', error);
          }
        },
        after: async (session) => {
          await trackLoginHook(session);
          await syncProfileEmailVerificationFromAuthUser(session.userId);
        }
      },
      update: {
        after: async (session) => {
          await trackLoginHook(session);
          await syncProfileEmailVerificationFromAuthUser(session.userId);
        }
      }
    }
  },
  plugins: [
    admin(),
    // `anonymous()` removed — it exposed POST /api/auth/sign-in/anonymous which creates accounts
    // (a public account-creation vector, unused by the client). Closed system: no anonymous users.
    // sso() + tokenExchange() are gated self-hosted-off (PearlLMS Phase 7 D5) — the two remaining
    // net-new-account doors; on a closed self-hosted system they must not be enable-able by a config row.
    ...buildStrangerAccountPlugins(),
    ...buildOAuthProxyPlugin(),
    loginLink(),
    // Attaches the user's org memberships ({ [orgId]: roleId }) to the session
    // so org-scoped middlewares can authorize without a per-request DB query.
    // Refreshes when the session cookie cache expires (see session.cookieCache.maxAge).
    customSession(async ({ user, session }) => {
      let orgRoles: Record<string, number> = {};
      // Account status (PearlLMS Phase 1) — carried on the session so the dashboard's
      // getActor can deny a deactivated user without a DB hop. The API resolver
      // (resolveActor) re-reads status fresh, so it is the authoritative enforcement point.
      let status: string = 'ACTIVE';
      try {
        if (user?.id) {
          orgRoles = await getUserOrgRolesMap(user.id);
          const [row] = await db
            .select({ status: schema.profile.status })
            .from(schema.profile)
            .where(eq(schema.profile.id, user.id))
            .limit(1);
          if (row?.status) status = row.status;
        }
      } catch (error) {
        console.error('customSession: failed to load orgRoles/status', error);
      }
      return { user, session, orgRoles, status };
    })
  ]
});
