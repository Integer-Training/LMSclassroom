import { createViewAsStudentToken, getAccountData, updateUser } from '@api/services/account';

import { Hono } from '@api/utils/hono';
import { ZUpdateProfile } from '@cio/utils/validation/account';
import { accountWorkspacesRouter } from '@api/routes/account/workspaces';
import { authMiddleware } from '@api/middlewares/auth';
import { getProfileById, updateProfile } from '@cio/db/queries/auth';
import { touchSession } from '@cio/db/queries/organization';
import { auth } from '@cio/db/auth';
import { AppError, ErrorCodes, handleError } from '@api/utils/errors';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { deleteCookie, getSignedCookie } from 'hono/cookie';
import { mintReturnToAdminToken } from '@api/services/organization/management';

const IMP_COOKIE_SECRET = process.env.BETTER_AUTH_SECRET ?? 'insecure-dev-secret-change-me';

// better-auth changePassword isn't on the inferred api type; narrow locally.
const changePasswordApi = auth.api as unknown as {
  changePassword: (args: {
    body: { currentPassword: string; newPassword: string; revokeOtherSessions?: boolean };
    headers: Headers;
  }) => Promise<unknown>;
};

export const accountRouter = new Hono()
  .route('/', accountWorkspacesRouter)
  .get('/', authMiddleware, async (c) => {
    const user = c.get('user')!;

    try {
      console.time('accountRouter');
      const accountData = await getAccountData(user.id);
      console.timeEnd('accountRouter');

      return c.json(
        {
          success: true,
          user,
          profile: accountData.profile,
          organizations: accountData.organizations,
          licenseFeatures: accountData.licenseFeatures
        },
        200
      );
    } catch (error) {
      return handleError(c, error, 'Failed to fetch account data');
    }
  })
  .put('/profile', authMiddleware, zValidator('json', ZUpdateProfile), async (c) => {
    const user = c.get('user')!;

    try {
      const validatedData = c.req.valid('json');

      const updatedProfile = await updateUser(user.id, validatedData);

      return c.json(
        {
          success: true,
          profile: updatedProfile
        },
        200
      );
    } catch (error) {
      return handleError(c, error, 'Failed to update profile');
    }
  })
  .post('/view-as-student-token', authMiddleware, async (c) => {
    const user = c.get('user')!;

    try {
      // Self sign-in only — mints a login-link token for the current user so they
      // can be auto-authenticated on the org domain to preview the student experience.
      const token = await createViewAsStudentToken({ id: user.id, email: user.email });

      return c.json(
        {
          success: true,
          data: { token }
        },
        200
      );
    } catch (error) {
      return handleError(c, error, 'Failed to create view-as-student token');
    }
  })
  // Self-service password change. Clears the mustChangePassword flag (force-change-on-first-login) on
  // success. Used both by the forced first-login gate and normal settings.
  .post(
    '/change-password',
    authMiddleware,
    zValidator('json', z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(128) })),
    async (c) => {
      const user = c.get('user')!;
      const { currentPassword, newPassword } = c.req.valid('json');
      try {
        await changePasswordApi.changePassword({
          body: { currentPassword, newPassword, revokeOtherSessions: false },
          headers: c.req.raw.headers
        });
      } catch {
        // better-auth throws when the current password is wrong or the new one fails policy.
        throw new AppError(
          'Could not change password. Check your current password and that the new one is at least 8 characters.',
          ErrorCodes.VALIDATION_ERROR,
          400
        );
      }
      await updateProfile(user.id, { settings: { mustChangePassword: false } });
      return c.json({ success: true }, 200);
    }
  )
  // Live-presence heartbeat: the client pings this every ~60s while the app is open. Bumps the current
  // session's updated_at so the admin "Online now" panel (which reads sessions refreshed within 5 min) is
  // accurate. Cheap single-row update; failures are swallowed (presence is best-effort).
  .post('/heartbeat', authMiddleware, async (c) => {
    const session = c.get('session')!;
    try {
      await touchSession(session.id);
    } catch (error) {
      console.error('[heartbeat] touchSession failed (non-fatal):', error);
    }
    return c.json({ success: true }, 200);
  })
  // "Return to admin" — end an impersonation session. Proof is the signed imp_admin cookie (the current
  // session is the impersonated learner/tutor, so this can't be admin-gated). Mints a login-link back to the
  // admin and clears the impersonation cookies.
  .post('/stop-impersonating', authMiddleware, async (c) => {
    try {
      const raw = await getSignedCookie(c, IMP_COOKIE_SECRET, 'imp_admin');
      if (!raw) throw new AppError('You are not impersonating anyone', ErrorCodes.VALIDATION_ERROR, 400);
      let parsed: { adminUserId?: string; adminEmail?: string };
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new AppError('Invalid impersonation state', ErrorCodes.VALIDATION_ERROR, 400);
      }
      if (!parsed.adminUserId || !parsed.adminEmail) {
        throw new AppError('Invalid impersonation state', ErrorCodes.VALIDATION_ERROR, 400);
      }
      const token = await mintReturnToAdminToken(parsed.adminUserId, parsed.adminEmail);
      deleteCookie(c, 'imp_admin', { path: '/' });
      deleteCookie(c, 'impersonating', { path: '/' });
      return c.json(
        {
          success: true,
          data: { loginLinkPath: `/api/auth/login-link?token=${encodeURIComponent(token)}&redirect=/` }
        },
        200
      );
    } catch (error) {
      return handleError(c, error, 'Failed to return to admin');
    }
  })
  .get('/profile', authMiddleware, async (c) => {
    const user = c.get('user')!;

    try {
      const profile = await getProfileById(user.id);

      if (!profile) {
        return c.json(
          {
            success: false,
            error: 'Profile not found'
          },
          404
        );
      }

      return c.json(
        {
          success: true,
          profile
        },
        200
      );
    } catch (error) {
      return handleError(c, error, 'Failed to fetch profile');
    }
  });
