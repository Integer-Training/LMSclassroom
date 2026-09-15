import { classroomio } from '$lib/utils/services/api';

// Admin "Login as" / "Return to admin". Login-as mints a login-link for the target and navigates the tab to
// consume it (the browser becomes that learner/tutor); a signed cookie remembers the admin so Return works.
// The readable `impersonating` cookie (target name, or '1') drives the banner.

type LinkResult = { success?: boolean; data?: { loginLinkPath?: string }; error?: string };

export async function loginAsMember(memberId: number): Promise<string | null> {
  const res = await classroomio.organization.management.members[':memberId']['login-as'].$post({
    param: { memberId: String(memberId) }
  });
  const body = (await res.json()) as LinkResult;
  if (res.ok && body.success && body.data?.loginLinkPath) {
    window.location.href = body.data.loginLinkPath;
    return null;
  }
  return body.error || 'Could not start impersonation.';
}

export async function stopImpersonating(): Promise<void> {
  const res = await classroomio.account['stop-impersonating'].$post();
  const body = (await res.json()) as LinkResult;
  if (res.ok && body.success && body.data?.loginLinkPath) {
    window.location.href = body.data.loginLinkPath;
  }
}

/** The target's name (or '' when unknown) if the current session is an impersonation, else null. */
export function readImpersonatingName(): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)impersonating=([^;]*)/);
  if (!m) return null;
  const v = decodeURIComponent(m[1]);
  return v === '1' ? '' : v;
}
