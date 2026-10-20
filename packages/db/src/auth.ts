import * as CONSTANTS from './constants';
import * as schema from '@db/schema';

import { LOGIN_RATE_LIMIT, PASSWORD_RESET_RATE_LIMIT } from '@cio/utils/constants';

import { admin } from 'better-auth/plugins';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
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
import {
  emailFromBody,
  getClientIp,
  recordLoginFailure,
  recordLoginSuccess,
  recordLogout
} from './auth/hooks/system-events';
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

const baseAuth: ReturnType<typeof betterAuth> = betterAuth({
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
    // PearlLMS Phase-10 HP/SA-2 — make Secure cookies explicit in production (better-auth would infer this, but
    // pinning it removes the footgun where a mis-set baseURL/NODE_ENV drops the Secure flag). Local http dev
    // must NOT set Secure or the cookie is silently dropped, hence the env gate. httpOnly + SameSite=Lax remain
    // better-auth's defaults for the session cookie (verified) — first-party auth, no cross-origin cookie send.
    useSecureCookies: process.env.NODE_ENV === 'production',
    // Browser auth is first-party through tenant-router or the dashboard proxy,
    // so cookies should stay host-only on the dashboard/public-site origin.
    crossSubDomainCookies: { enabled: false },
    // Caddy (our only edge) sets a trusted, single-valued x-forwarded-for, so sign-in throttles per real client IP.
    // If a CDN/LB is ever added in front of Caddy, trustedProxies must be configured or XFF becomes spoofable.
    ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
    database: {
      generateId: false
    }
  },
  account: {
    storeAccountCookie: true
  },
  // PearlLMS Phase-10 HP/SA-4 (O3) — per-IP throttles on the credential endpoints (was better-auth's generic
  // default). Values are config-driven from @cio/utils LOGIN_RATE_LIMIT / PASSWORD_RESET_RATE_LIMIT. better-auth
  // enables rate-limiting in production by default; the customRules pin the sensitive paths tighter than the
  // global bucket. Path keys are relative to the auth base (no /api/auth prefix).
  rateLimit: {
    customRules: {
      // Internal SSR session check cannot resolve a client IP and shares one bucket; exempt it entirely.
      '/get-session': false,
      '/sign-in/email': { window: LOGIN_RATE_LIMIT.window, max: LOGIN_RATE_LIMIT.max },
      '/forget-password': { window: PASSWORD_RESET_RATE_LIMIT.window, max: PASSWORD_RESET_RATE_LIMIT.max },
      '/request-password-reset': { window: PASSWORD_RESET_RATE_LIMIT.window, max: PASSWORD_RESET_RATE_LIMIT.max }
    }
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
  // PearlLMS Phase 10 — system_event_log capture (best-effort; hooks never throw and never alter the response).
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Logout is captured BEFORE the endpoint runs: the session is already deleted by the time an after-hook
      // fires. Returning undefined leaves the request untouched.
      try {
        if (ctx.path !== '/sign-out') return;
        const found = await getSessionFromCtx(ctx);
        recordLogout({
          userId: found?.user?.id ?? null,
          userEmail: found?.user?.email ?? null,
          ip: getClientIp(ctx.request?.headers ?? ctx.headers)
        });
      } catch (error) {
        console.error('[auth] system-event logout capture failed:', error);
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      try {
        if (ctx.path !== '/sign-in/email') return;
        const returned = ctx.context.returned;
        // Invalid credentials only. 403 deactivated is logged in session.create.before; 429 never reaches
        // endpoint hooks (see the handler wrapper at the bottom of this file).
        if (returned instanceof APIError && returned.statusCode === 401) {
          recordLoginFailure('bad_credentials', {
            userEmail: emailFromBody(ctx.body),
            ip: getClientIp(ctx.request?.headers ?? ctx.headers),
            httpStatus: 401,
            message: returned.message
          });
        }
      } catch (error) {
        console.error('[auth] system-event login-failure capture failed:', error);
      }
    })
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
              try {
                const [u] = await db
                  .select({ email: schema.user.email })
                  .from(schema.user)
                  .where(eq(schema.user.id, session.userId))
                  .limit(1);
                recordLoginFailure('deactivated', {
                  userId: session.userId,
                  userEmail: u?.email ?? null,
                  ip: session.ipAddress ?? null,
                  httpStatus: 403,
                  message: 'Deactivated account sign-in blocked'
                });
              } catch {
                /* best-effort */
              }
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
          try {
            const [u] = await db
              .select({ email: schema.user.email })
              .from(schema.user)
              .where(eq(schema.user.id, session.userId))
              .limit(1);
            recordLoginSuccess(session, u?.email ?? null);
          } catch {
            /* best-effort */
          }
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
  // PearlLMS Phase-10 Step-5 — better-auth ≥1.6.11 (OAuth refresh-token-replay + SSO criticals fixed) tightened
  // the endpoint-options type (`operationId` now required), so the deeply-inferred `Auth<{…our options…}>` is no
  // longer *assignable* to the widened, nameable `ReturnType<typeof betterAuth>` annotation (which the .d.ts
  // build needs to avoid TS2742). The runtime object IS a valid better-auth instance — only the two deep inferred
  // types disagree — so we cast. Revisit if better-auth reconciles the generic/`BetterAuthOptions` API types.
}) as unknown as ReturnType<typeof betterAuth>;

/**
 * Rate-limit capture. better-auth's 429 is returned from the router's onRequest, BEFORE any endpoint hook runs,
 * so hooks.after can never see it. Wrap the fetch handler (apps/api's auth route is the only caller) and, for a
 * 429 on POST /sign-in/email, record 'auth.login.failure' reason 'rate_limited'. The response is returned
 * untouched; the request body is read from a clone only on that path.
 */
const baseHandler = baseAuth.handler;
baseAuth.handler = async (request: Request) => {
  let email: string | null = null;
  let isSignIn = false;
  try {
    isSignIn = request.method === 'POST' && new URL(request.url).pathname.endsWith('/sign-in/email');
    if (isSignIn) {
      email = emailFromBody(await request.clone().json());
    }
  } catch {
    /* body unreadable — email stays null */
  }
  const response = await baseHandler(request);
  try {
    if (isSignIn && response.status === 429) {
      recordLoginFailure('rate_limited', {
        userEmail: email,
        ip: getClientIp(request.headers),
        httpStatus: 429,
        message: 'Sign-in rate limit exceeded'
      });
    }
  } catch {
    /* best-effort */
  }
  return response;
};

export const auth = baseAuth;
