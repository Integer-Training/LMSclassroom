import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

// The forced first-login password change. A learner signs in with the admin-issued temporary password and is sent
// to /change-password; asking for that temporary password again left one learner stuck for hours. While
// mustChangePassword is set (and the session is not an admin "view as"), only the new password is needed. A normal
// change still requires the current password, and a wrong one now says so.

const changePassword = vi.fn();
vi.mock('@cio/db/auth', () => ({ auth: { api: { changePassword: (...a: unknown[]) => changePassword(...a) } } }));
vi.mock('@cio/db/queries/auth', () => ({ getProfileById: vi.fn(), updateProfile: vi.fn(async () => undefined) }));
vi.mock('@cio/db/queries/organization', () => ({
  setCredentialPassword: vi.fn(async () => undefined),
  touchSession: vi.fn(async () => undefined)
}));
vi.mock('@api/services/account', () => ({
  createViewAsStudentToken: vi.fn(),
  getAccountData: vi.fn(),
  updateUser: vi.fn()
}));
vi.mock('@api/routes/account/workspaces', async () => ({ accountWorkspacesRouter: new (await import('hono')).Hono() }));
vi.mock('@api/services/organization/management', () => ({ mintReturnToAdminToken: vi.fn() }));

import { getProfileById, updateProfile } from '@cio/db/queries/auth';
import { setCredentialPassword } from '@cio/db/queries/organization';
import { accountRouter } from '@api/routes/account/account';
import { handleError } from '@api/utils/errors';

const mockedProfile = vi.mocked(getProfileById);
const mockedSetPassword = vi.mocked(setCredentialPassword);
const mockedUpdateProfile = vi.mocked(updateProfile);

function appFor(session: { impersonatedBy?: string | null } = {}) {
  return new Hono()
    .use('*', async (c, next) => {
      c.set('user' as never, { id: 'u-learner', email: 'l@example.com' } as never);
      c.set('session' as never, { id: 's-1', ...session } as never);
      await next();
    })
    .route('/account', accountRouter as unknown as Hono)
    .onError((err, c) => handleError(c, err, 'test'));
}

function post(app: Hono, body: unknown) {
  return app.request('/account/change-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

const flagged = { id: 'u-learner', settings: { mustChangePassword: true } } as never;
const normal = { id: 'u-learner', settings: {} } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('forced first-login change', () => {
  it('sets the new password without the temporary one and clears the flag', async () => {
    mockedProfile.mockResolvedValue(flagged);
    const res = await post(appFor(), { newPassword: 'MyNewPass1' });

    expect(res.status).toBe(200);
    expect(mockedSetPassword).toHaveBeenCalledWith('u-learner', 'MyNewPass1');
    expect(changePassword).not.toHaveBeenCalled();
    expect(mockedUpdateProfile).toHaveBeenCalledWith('u-learner', { settings: { mustChangePassword: false } });
  });

  it('still enforces the 8-character minimum', async () => {
    mockedProfile.mockResolvedValue(flagged);
    const res = await post(appFor(), { newPassword: 'short' });

    expect(res.status).toBe(400);
    expect(mockedSetPassword).not.toHaveBeenCalled();
  });

  it('an admin viewing as the learner cannot set their password without the current one', async () => {
    mockedProfile.mockResolvedValue(flagged);
    const res = await post(appFor({ impersonatedBy: 'u-admin' }), { newPassword: 'MyNewPass1' });

    expect(res.status).toBe(400);
    expect(mockedSetPassword).not.toHaveBeenCalled();
    expect(mockedUpdateProfile).not.toHaveBeenCalled();
  });
});

describe('normal password change', () => {
  it('requires the current password', async () => {
    mockedProfile.mockResolvedValue(normal);
    const res = await post(appFor(), { newPassword: 'MyNewPass1' });
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe('Enter your current password.');
    expect(mockedSetPassword).not.toHaveBeenCalled();
  });

  it('changes it through better-auth when the current password is right', async () => {
    mockedProfile.mockResolvedValue(normal);
    changePassword.mockResolvedValue({});
    const res = await post(appFor(), { currentPassword: 'OldPass12', newPassword: 'MyNewPass1' });

    expect(res.status).toBe(200);
    expect(changePassword).toHaveBeenCalledOnce();
    expect(mockedSetPassword).not.toHaveBeenCalled();
  });

  it('says plainly when the current password is wrong', async () => {
    mockedProfile.mockResolvedValue(normal);
    changePassword.mockRejectedValue(new Error('INVALID_PASSWORD'));
    const res = await post(appFor(), { currentPassword: 'nope', newPassword: 'MyNewPass1' });
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe('Your current password is incorrect.');
    expect(mockedUpdateProfile).not.toHaveBeenCalled();
  });
});
