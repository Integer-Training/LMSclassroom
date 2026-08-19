// PearlLMS Phase 7 Step 5 (docs/INTEGRATIONS.md T4) — UserJot is DISABLED. It transmitted id/email/name/avatar
// to cdn.userjot.com and was only flag-gated off; per the owner-signed register it is now inert. These are
// no-op stubs (the same exports the callers import) — NO SDK script is ever injected, NO identity is ever sent,
// and there is no reference to cdn.userjot.com anywhere. Mirrors the Phase-0 PostHog/Umami neutering.

export type UserJotIdentity = {
  id: string;
  email?: string;
  fullname?: string | null;
  avatarUrl?: string | null;
};

export type UserJotWidgetSection = 'feedback' | 'roadmap' | 'updates';

export function initUserJot(): void {
  /* disabled — no-op */
}

export function identifyUserJotUser(_identity: UserJotIdentity): void {
  /* disabled — no-op; no learner identity ever leaves */
}

export function clearUserJotUser(): void {
  /* disabled — no-op */
}

export function showUserJotWidget(_section: UserJotWidgetSection): void {
  /* disabled — no-op */
}
