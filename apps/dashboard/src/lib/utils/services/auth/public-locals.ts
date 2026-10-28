import type { Actor } from '@cio/utils/auth';

// PearlLMS scalability Phase C1 — what the ROOT layout ships to the browser. The server-side `locals` is the whole
// get-session payload, including the session row (token, ipAddress, userAgent) and the organizations[] plan payload;
// none of that is used by the client. Keep to the fields the client reads:
//   user            -> analytics identity, user store, setupApp
//   profile.locale  -> initial translations (routes/+layout.ts)
//   orgRoles        -> setupApp's "am I a member of this tenant?" check
//   status, actor   -> UI authorization hints (the API re-checks every call)

type SessionLikeUser = App.Locals['user'];

export type PublicLocals = {
  user: SessionLikeUser;
  profile: { locale: string | null } | null;
  orgRoles?: Record<string, number>;
  status?: string;
  actor?: Actor;
  fromSessions?: boolean;
};

export function toPublicLocals(locals: Partial<App.Locals> | null | undefined): PublicLocals {
  const profileLocale = locals?.profile?.locale;

  return {
    user: locals?.user ?? null,
    profile: locals?.profile ? { locale: profileLocale ?? null } : null,
    ...(locals?.orgRoles ? { orgRoles: locals.orgRoles } : {}),
    ...(locals?.status ? { status: locals.status } : {}),
    ...(locals?.actor ? { actor: locals.actor } : {}),
    ...(locals?.fromSessions ? { fromSessions: true } : {})
  };
}
