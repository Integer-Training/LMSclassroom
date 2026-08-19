# ONBOARDING-MODEL.md — governed intake, signup closure & integrations groundwork (Phase 7 spec)

Phase 7 turns learner intake into a **governed, ordered, audited** flow. A prospect applies through a public
registration form and **never gets an account by doing so**; Manager/Admin work an **oldest-first approval
queue**; approval activates the account + enrolment through the **existing Phase-5 lite-onboarding service**
(composed, not copied). Identity verification is **recorded** against the learner (no documents stored). Every
integration in the fork gets an explicit keep/disable verdict (Step 5), proven by a fresh egress audit.

This is the design of record. Steps 2–5 are built straight from it. **Nothing here is built yet** — the five
decisions below need the owner's confirmation before Step 2.

---

## ⚠️ Five decisions flagged for the owner (confirm before Step 2)

| # | Decision | Recommendation | Why |
|---|---|---|---|
| **D1** | Rejection notification | **None automated in v1** | Reject records a status + note; staff communicate off-platform. A "not taken forward" email is more build + a deliverability/GDPR surface for a message staff can send by hand. |
| **D2** | ID-document storage | **None** | Record that a check *happened* (status/method/who/when/note) — never the document. Storing documents later is a separate flagged decision needing its own retention + access rules. (Scope fence: no upload/storage this phase.) |
| **D3** | Who records ID checks | **Manager/Admin + the learner's allocated Tutor** | Induction reality: the tutor running the ID-check session often sights the document. Enforced with existing predicates — `isRole(ADMIN\|MANAGER)` OR `isAllocatedTutor(actor, learnerId)`. |
| **D4** | Spam controls | **Honeypot field + per-IP rate limit from config; no third-party CAPTCHA** | Config-light: a hidden honeypot (bots fill it → silently drop) + a per-client-IP submission limit. No external CAPTCHA service (scope fence; Phase 10 may harden). |
| **D5** | Signup closure | **Keep the current invite-only posture; the registration form becomes the sole public entrance; gate the two inert net-new-account plugins self-hosted-off** | Signup is already closed (§2, live-verified §1). The only residual doors — `tokenExchange()` + `sso()` JIT — are inert-by-empty-table; gating them behind `PUBLIC_IS_SELFHOSTED` stops them being enabled by a config row. |

> **✅ All five confirmed by the owner on 2026-08-18 ("all recommended").** Steps 2–5 build to these decisions
> as settled: no rejection email (D1), no document storage (D2), Manager/Admin + allocated Tutor record ID
> checks (D3), honeypot + per-IP rate limit (D4), signup stays invite-only with the two inert plugins gated
> self-hosted-off (D5).

---

## 1. Current signup behaviour — from a LIVE attempt (2026-08-18, api :3002)

Attempted against the running API, actual outcomes recorded verbatim:

| Attempt | Result | Meaning |
|---|---|---|
| `POST /api/auth/sign-up/email` (no org header) | **400 `ORG_CONTEXT_REQUIRED`** — "Organization context is required for signup on self-hosted instances" | An org-context hook fires **before** the signup-enabled check. |
| `POST /api/auth/sign-up/email` (**with** `cio-org-id` header) | **400 `EMAIL_AND_PASSWORD_SIGN_UP_IS_NOT_ENABLED`** | Even past org context, `disableSignUp:true` blocks. **Two layers, both closed.** No user row. |
| `POST /api/auth/sign-in/anonymous` | **404** | `anonymous()` plugin removed. |
| `POST /api/auth/sign-in/social` (google) | **400 `SOCIAL_AUTH_NOT_ENABLED`** | No `socialProviders`; Google removed. |
| dashboard `/signup` | **308 → /login** (code-confirmed `(auth)/signup/+page.server.ts:5`; dashboard not running this check) | UI retired; no self-registration render path. |
| self-hosted `auto-join` | **403 "closed system"** (code-confirmed `auto-join.ts:106-112`) | Membership door, refused net-new self-service on self-hosted. |

**Conclusion:** an uninvited stranger cannot create an account today. The account-creation door itself is
live-verified closed at two layers.

## 2. The doors, and the closure (D5)

Account creation flows through exactly one staff-gated primitive: **`createOrgUser`**
(`apps/api/src/services/organization/users.ts:49-110`) → `auth.api.createUser` (header-less) →
`createOrganizationMember(verified:true)` → `auth.api.requestPasswordReset` (the **set-password invite** — a
reset-password token to `${DASHBOARD_ORIGIN}/reset`) → audit `user.created`. The "invite token" is the
reset-password token; there is no separate provisioning invite-hash.

Two residual net-new-account doors, both inert (empty backing tables) and both requiring an admin to first
populate config:
- **`tokenExchange()`** — would call `signUpEmail` for an unknown email, but only with an ACTIVE
  `organization_token_auth` row + a valid org-signed JWT (≤5 min). Under `disableSignUp` the create branch is
  likely dead anyway.
- **`sso()` JIT** — a real IdP login for a domain matching an ACTIVE `organization_sso_config` JIT-creates the
  user. Tables empty; the admin registration route is license-gated.

**Closure (Step 2):** gate both plugins behind `PUBLIC_IS_SELFHOSTED !== 'true'` in `packages/db/src/auth.ts`
(a 2-line change mirroring the existing `buildOAuthProxyPlugin` self-hosted skip), so neither can be switched on
by inserting a config row. Nothing about the existing password-signup closure changes. The new public
`POST /register` writes **only** a pending row and never touches the auth stack.

## 3. Schema (Step 2 migration; repo-exact style — `pgTable`, `uuid().defaultRandom()` PK, enum-ish values are
`varchar` with the set in config not a pg-enum, authorship FKs nullable `set null`, `timestamp(withTimezone,
mode:'string')`)

**`registration`** — a pending application, NEVER an account:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` | uuid → organization | cascade |
| `full_name` | varchar | |
| `email` | varchar | stored lowercased + trimmed |
| `requested_course_id` | uuid → course | nullable, **set null** — the course asked for; approval can change it |
| `status` | varchar | config set `REGISTRATION_STATUS = ['pending','approved','rejected']`, default `'pending'` |
| `decision_note` | text | nullable |
| `decided_by` | uuid → profile | nullable, set null |
| `decided_at` | timestamptz | nullable |
| `created_at` | timestamptz | = `submitted_at` |

Index `(organization_id, status, created_at)` for the oldest-first queue.

**`id_verification`** — one current record per learner:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `learner_id` | uuid → profile | cascade, **unique** — one row per learner, upserted |
| `status` | varchar | config set `ID_VERIFICATION_STATUS = ['not_verified','verified','failed']`, default `'not_verified'` |
| `method` | varchar | config set `ID_VERIFICATION_METHODS = ['passport','driving_licence','other']` (the ID sighted; labels in config) |
| `verified_by` | uuid → profile | nullable, set null |
| `verified_at` | timestamptz | nullable |
| `note` | text | nullable |
| `updated_at` | timestamptz | |

**No document column of any kind (D2).** Config constants live in `packages/utils/src/constants/` beside
`result.ts` / `unit-type.ts`, each with an `isAllowed…` predicate + a zod validator (the phase's established
pattern).

## 4. State machine + ordering
- **One-way:** `pending → approved` OR `pending → rejected`; both terminal (no re-open, no reject-after-approve).
  The decide service asserts `status === 'pending'` before any transition (**409** otherwise), so double-approve
  or approve-then-reject is refused.
- **Oldest-first queue:** `ORDER BY created_at ASC` — mirrors the caseload's longest-waiting-on-top
  (`services/caseload/caseload.ts:129`).

## 5. Approval transaction — COMPOSE Phase 5, do not duplicate
Approve calls the existing **`onboardLearner(actor, { name, email, courseId })`**
(`apps/api/src/services/onboarding/onboarding.ts:52`), which already composes `createOrgUser` (account +
set-password invite + `user.created` audit) + `addCourseMember` enrolment + compliance records. The approve
service:
1. Load the registration; assert `pending`.
2. Resolve the course — the registration's `requested_course_id`, or an admin-adjusted `courseId` in the
   approve payload (validated published + in-org exactly as `onboardLearner` already guards).
3. Call `onboardLearner`.
4. On success, mark the row `approved` + `decided_by`/`decided_at`.
5. Audit `registration.approved`.

It inherits `onboardLearner`'s fail-before-write + best-effort-tail contract (the row is marked approved only
after it returns; a post-provision tail failure is not rolled back — same as Phase 5). **Reject:** assert
`pending` → set `rejected` + `decision_note` + `decided_by`/`decided_at` → audit `registration.rejected`. No
account is touched on reject.

## 6. Notification additions (Phase 6 framework)
- **New category `registration`** in `packages/utils/src/constants/notification.ts` with
  `NOTIFICATION_EMAIL_DEFAULTS.registration = true` (staff-actionable → email default ON) + a manager-facing
  label ("New learner registrations"). Pure config edit (array + category map + default + label) — **no
  migration** (notification type/category are varchar). Reusing `coursework` was rejected: its learner-facing
  toggle must not carry a staff alert.
- **New type `registration.submitted`** → category `registration`. On a public submission,
  `emitNotification` (`services/comms/notify.ts:45`) fires to every Manager + Admin in the org (in-app always +
  email per preference). Content-light email template `registrationSubmitted` — "a new registration is waiting"
  + a link to the queue; **no applicant PII beyond a first name**, per the Phase-6 content-light rule.
- **New query `getOrgManagersAndAdmins(orgId)`** in `queries/organization/organization.ts` — mirror
  `getOrganizationTeam` but `inArray(roleId, [ROLE.ADMIN, ROLE.MANAGER])`, returning `{ userId: profileId,
  email }` per recipient. `registration.approved` / `.rejected` are audited but **not** notified in v1 (D1 = no
  applicant-facing notification).

## 7. Audit actions (ids/enums only, never PII values — the Phase-1 rule)
Add to `AUDIT_ACTIONS`:
- `REGISTRATION_APPROVED = 'registration.approved'` — `{ registrationId, courseId }`
- `REGISTRATION_REJECTED = 'registration.rejected'` — `{ registrationId }` (the note text is NOT in metadata)
- `ID_VERIFICATION_RECORDED = 'id_verification.recorded'` — `{ learnerId, status, method }`

`registration.submitted` is a notification, not an audited privileged decision (it is an anonymous public
write), so it is **not** an audit action.

## 8. Access rows (added to docs/ACCESS.md §11 in Step 2)

| Surface | Endpoint | Guard | Access |
|---|---|---|---|
| Public register (create pending) | `POST /register` (via dashboard `(auth)/register` action) | `apiKeyMiddleware` + honeypot + per-IP rate limit | **Anonymous**, rate-limited; writes ONLY a `registration` row — never the auth stack |
| Approval queue (list) | `GET /organization/registrations?status=pending` | `requireManagerOrAdmin` + org-bound | **Manager/Admin**; oldest-first |
| Approve / reject | `POST /organization/registrations/:id/{approve,reject}` | `requireManagerOrAdmin` | **Manager/Admin**; one-way; audited |
| Record ID check | `PUT /organization/id-verification/learner/:learnerId` (as-built) | `requireActor` + in-service `isRole(ADMIN\|MANAGER)` OR `isAllocatedTutor` (D3) | **Manager/Admin + allocated Tutor** |
| ID status (self) | `GET /organization/id-verification/me` (surfaced on the ID-check session) | `requireActor` + self | **Learner, self only** — informational |

**Spam-control placement (Step 2):** the honeypot + per-IP rate limit apply at the **SvelteKit form-action
boundary**, where `getClientAddress()` sees the real visitor IP and the API key stays server-side; the API
route itself stays `apiKeyMiddleware`-guarded (the invite-preview public pattern:
`routes/invite/invite.ts:165-181`).

## 9. Duplicate-email rules (clear refusal, no enumeration leak)
On public submit, if the email matches an existing **user** OR an **open pending registration**, refuse with a
generic message ("if you've already applied or have an account, please sign in or contact us") — do NOT confirm
which, to avoid account enumeration. A prior `approved`/`rejected` registration does not block a fresh
application. `createOrgUser` already 409s on a duplicate user at approve time as a backstop.

## 10. Integrations register — groundwork (raw inventory; verdicts assigned in Step 5)

Recorded now so Step 5 assigns a keep/disable/defer verdict against a fixed list, then proves it with a fresh
egress audit. Current state reflects the Phase-0 privacy patches already applied.

**Infra (our own, always-on):** Supabase Postgres (pooler 6543 runtime / 5432 migrations), Supabase Storage S3
(documents/videos private, media public-read), SMTP (env-driven; Mailpit local), Redis (internal only).

**Key-gated external APIs (call only when a key is set — unset today):** `api.openai.com` Whisper
(transcription), AI providers OpenAI/Anthropic/Google/Moonshot (ai-tutor, question-gen, course-gen),
`r.jina.ai` (agent doc-fetch, SSRF-guarded + paid-gated), `api.unsplash.com` (cover images),
`api.cloudflare.com` (certificate render — certs out of scope), `api.polar.sh` (billing — dormant; self-hosted
auto-ENTERPRISE bypasses it).

**Telemetry/widgets present but self-hosted-off:** UserJot (`isWidgetAllowed()` false when self-hosted — BASELINE
flags for hard-removal), Senja (`no-tracking` license → off), Tinybird (`TINYBIRD_TOKEN` unset → off), Sentry
(DSN + not-self-hosted gated → off).

**Removed / inert (Phase-0 Step-4):** PostHog (no-op), Umami (no-op), license phone-home
(`enterprise-api.classroomio.dev` — `fetchLicenseFromApi` deleted, locked by `no-phone-home.test.ts`).

**Passive client embeds (no server egress):** lesson videos are user-supplied external URLs rendered as passive
iframes/players — YouTube, Google Drive, muse.ai, generic; upload path goes to our Supabase HLS pipeline. The
oEmbed server proxy is PRD-only, not implemented.

**Inbound automation (no outbound):** org automation keys + `public-api/v1` (mcp/api/zapier scopes,
sha256-hashed keys); the only inbound webhook is Polar (dead without `POLAR_*`). No outbound webhooks (the
`webhooks` queue is declared-but-dead).

**Commerce:** `payment-request.ts` is manual/offline (two emails, no charge); Polar dormant; Stripe declared in
`package.json` but **unwired** (no runtime import). No GPTZero/plagiarism surface exists.

**Egress re-audit (Step 5)** reuses the Phase-0 method (undici `request:create` diagnostics probe + built-bundle
grep + `no-phone-home` unit test + repo grep). Swept set = the Phase-0 domains
(`*.posthog.com`, `umami.hz.oncws.com`, `enterprise-api.classroomio.dev`) **extended** with the key-gated hosts
(`api.tinybird.co`, `cdn.userjot.com`, `widget.senja.io`, `*.sentry.io`, `r.jina.ai`, `api.polar.sh`,
`api.openai.com`, `api.unsplash.com`, `api.cloudflare.com`, and the AI-provider hosts) so each is verified inert
with no key configured.

**Future integrations (recorded as flagged decisions, NOT built this phase):** e-portfolio export, funding/ILR
exports, HR/finance sync, ID-document storage (D2 opt-in), bulk CSV import, real payment/commerce, external
CAPTCHA. Step 5's register lists each with a **defer** verdict + a one-line rationale; building any is a future
phase.

## 11. Exit-criteria mapping (Step 1)
- Doc committed with the five flagged decisions (§⚠️), schema (§3), state machine (§4), approval transaction
  (§5), notification/audit additions (§6/§7), access rows (§8), duplicate rules (§9), integrations groundwork
  (§10). ✅
- Current signup behaviour documented from a **live** attempt (§1), not assumption. ✅
- Owner confirms D1–D5 before Step 2 begins. ✅ (confirmed 2026-08-18, "all recommended")
