import { auth } from '@cio/db/auth';
import type { TOrganizationApiKey } from '@db/types';
import type { Actor } from '@cio/db/actor';

export type AuthSession = {
  Variables: {
    // The single resolved authorization identity (role + status), from resolveActor().
    // Deny-by-default: check `actor.authenticated` — false covers anonymous AND deactivated.
    actor: Actor;
    actorId: string | null;
    automationKey: TOrganizationApiKey | null;
    orgId: string | null;
    orgRoles: Record<string, number>;
    session: typeof auth.$Infer.Session.session | null;
    user: typeof auth.$Infer.Session.user | null;
    userRole: number | null;
  };
};
