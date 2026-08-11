# TODO — Email branding (deferred; do NOT rebrand in Phase 0)

Inventory of hardcoded **ClassroomIO** branding in the email layer, found during
Step 7 (SMTP verification). These are cosmetic/brand strings only — none are
functionally broken (all links resolve correctly via `DASHBOARD_ORIGIN`). Rebrand
to Pearl LMS in a later, dedicated pass. Sender **addresses** and **reply-to** are
already env-driven (`SMTP_SENDER` / `SMTP_REPLY_TO`); the items below are display
copy, logos, and fallback defaults.

## Shared base template (highest impact — affects every email)

- `packages/email/src/templates/default.ts:26` — `CLASSROOMIO_LOGO` masthead image
  (external ClassroomIO CDN asset) rendered at the top of every email.
- `packages/email/src/templates/default.ts:151` — footer
  `ClassroomIO {year}. All rights reserved.`

## Fallback sender identity (only used when env unset)

- `packages/email/src/utils/constants.ts:30` — `DEFAULT_EMAIL_FROM`
  `"Best from ClassroomIO" <notify@mail.classroomio.com>` (overridden by `SMTP_SENDER`).
- `packages/email/src/utils/constants.ts:31` — `DEFAULT_EMAIL_REPLY_TO`
  `"Best from ClassroomIO" <help@classroomio.com>` (overridden by `SMTP_REPLY_TO`).

## Per-template subjects / body copy

- `packages/email/src/emails/forgot-password.ts` — subject `… - ClassroomIO`; body
  "your ClassroomIO account"; support address `help@classroomio.com`.
- `packages/email/src/emails/on-password-reset.ts` — subject `… - ClassroomIO`.
- `packages/email/src/emails/invite-teacher.ts` — subject `… on ClassroomIO`; body
  "on ClassroomIO".
- `packages/email/src/emails/welcome.ts` — subject `Welcome to ClassroomIO!`; body
  "the founder of ClassroomIO".
- Other templates under `packages/email/src/emails/*` (student-org-invite,
  student-course-invite, cohort/session reminders, etc.) inherit the shared masthead
  + footer above and may carry their own "ClassroomIO" copy — sweep the whole
  `emails/` dir during the rebrand.

## Dynamic "via ClassroomIO.com" suffix + org fallback

- `packages/db/src/auth/email-verification.ts:48` — org-name fallback `'ClassroomIO'`
  when no org resolves; `:53` — From display name `\`${org.name} (via ClassroomIO.com)\``.
- `apps/api/src/services/organization/invite.ts:271` — From display name
  `\`${org.name} (via ClassroomIO.com)\``; `:272` — subject `… on ClassroomIO`.

## Not branding (already correct)

- All email links use `DASHBOARD_ORIGIN` via `getDashboardBaseUrl()` /
  `getAppBaseUrl()` (`packages/core/src/config/dashboard-url.ts`) — they point at our
  app, not classroomio.com. No link fix needed.
