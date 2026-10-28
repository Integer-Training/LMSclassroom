import { auth } from '@cio/db/auth';
import type { TOrganizationApiKey } from '@db/types';
import type { Actor } from '@cio/db/actor';

export type AuthSession = {
  Variables: {
    // Per-request correlation id (HP/SA-5). Echoed in the `x-correlation-id` response header and included in
    // sanitised error responses + the server-side error log, so a user-reported error id maps to its log line.
    correlationId: string;
    // Set by middlewares/hls-fast-path.ts when a verified HLS cookie let this request skip session/Actor resolution.
    hlsFastPath?: boolean;
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
