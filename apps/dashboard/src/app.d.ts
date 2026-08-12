import type { TUser, TSession, TProfile, TOrganization, TOrganizationmember, TOrganizationPlan } from '@cio/db/types';
import type { Actor } from '@cio/utils/auth';

type AccountOrganization = TOrganization & {
  member: TOrganizationmember | null;
  plan:
    | (Pick<TOrganizationPlan, 'planName' | 'isActive' | 'provider' | 'subscriptionId'> & { customerId: string })
    | null;
};

// src/app.d.ts
declare global {
  namespace App {
    interface Locals {
      user: TUser | null;
      session: TSession | null;
      profile: TProfile | null;
      organizations: AccountOrganization[];
      fromSessions?: boolean;
      // Single resolved authorization identity (role + status) — set in getSessionData
      // via getActor(). Deny-by-default: check actor.authenticated.
      actor?: Actor;
      orgRoles?: Record<string, number>;
      status?: string;
      // getAccount: () =>
    }
    // interface PageData {}
    // interface Error {}
    // interface Platform {}
  }
}

export {};
