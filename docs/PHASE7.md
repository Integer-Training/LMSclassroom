# PHASE 7 — verification report: full onboarding & integrations exit criteria

Phase 7 turned intake into a governed, ordered, audited flow and put every integration under an explicit
verdict: (1) `ONBOARDING-MODEL.md` + five owner-confirmed decisions; (2) invite-only signup + a public
registration form → pending row; (3) a Manager/Admin approval queue that activates accounts through the Phase-5
service; (4) ID-verification recording + the id-check session tie-in; (5) the integrations register + disablements
+ egress re-audit. This report is the independent exit sign-off.

**Method.** A reviewer verified the exit criteria statically (grep + read + suite vs BASELINE). An adversarial
pass then attacked every account-creation and decision path — live over HTTP against the running API **and** at
the service layer — with every attempt logged; zero successes permitted. A full E2E ran in one sitting. All on
localhost against the shared Supabase dev DB; production untouched.

**Verdict: PASS.** Every exit criterion holds. **19 forbidden accesses refused, 0 breaches**; no account is
creatable outside the approved flows; the E2E passes end-to-end with every audit row; the full API suite is
**448 passed** with only the 6 documented BASELINE F1 load-failures.

---

## 1. Exit criteria — pass/fail with evidence

| # | Exit criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | ONBOARDING-MODEL decisions D1–D5 implemented as confirmed | **PASS** | D1 no rejection email (reject records status+note only, `decisions.ts` `rejectRegistration`); D2 no ID-document storage (`id_verification` has no document column; diff-swept); D3 ID recording by Manager/Admin OR allocated Tutor (`id-verification.ts` `assertCanRecordFor` → `isRole` OR `isAllocatedTutor`); D4 honeypot + per-IP rate limit, no CAPTCHA (`registration.ts` + `rate-limit.ts`); D5 signup invite-only + `sso()`/`tokenExchange()` gated self-hosted-off (`auth.ts` `buildStrangerAccountPlugins`). |
| 2 | Single create+enrol path | **PASS** | The `createOrgUser`+`addCourseMember` composition exists ONLY in `services/onboarding/onboarding.ts`; `services/registration/decisions.ts` calls `onboardLearner` (never the primitives). Grep-verified. |
| 3 | One-way state machine, server-side | **PASS** | `claimPendingRegistration` = atomic `UPDATE … WHERE status='pending' RETURNING` inside `runInTransaction` — a decided row re-decide → 409 (adversarial F1/F2), a double-fire → one account (F4), a failure rolls the flip back (F3). |
| 4 | Audit coverage + compliant metadata | **PASS** | `registration.approved {registrationId,courseId}`, `registration.rejected {registrationId}`, `id_verification.recorded {learnerId,status,method}` — all recorded; NO note text or PII value in any metadata (E2E asserted the note is absent from all three). |
| 5 | INTEGRATIONS sign-offs vs disablements vs egress | **PASS** | 29 ✅ sign-offs, 0 pending. Disablements live-verified: `/public-api/v1` + `/organization/automation` → **404** with the `blockWhenSelfHosted` body; the `/api/polar/*` routes deleted; UserJot neutered (`cdn.userjot.com` gone from the built bundle). Egress re-audit recorded in `BASELINE.md`. |
| 6 | No document-storage surfaces | **PASS** | Grep of the `id_verification` schema/service/route/queries/UI for upload/document/file/attachment/presign → only comments **stating** none is stored. |
| 7 | ACCESS.md rows live | **PASS** | `docs/ACCESS.md` §10 (registration public-create / queue / approve-reject) + §11 (id-verification record / self-status) match the enforced guards (`requireManagerOrAdmin`, `requireActor` + in-service role/allocation). |
| 8 | Full suite vs BASELINE | **PASS** | `pnpm vitest run` (apps/api): **448 passed**; 6 files fail to LOAD — exactly the BASELINE F1 set. Zero assertion failures, zero new load-failures. |

Independent static review folded into §6.

## 2. Adversarial log — 19 forbidden attempts, 0 breaches

**Live over HTTP (running API, `PUBLIC_IS_SELFHOSTED=true`):**

| ID | Attempt | Result |
|---|---|---|
| H1 | `POST /api/auth/sign-up/email` (no org) | **400** `ORG_CONTEXT_REQUIRED` |
| H2 | `POST /api/auth/sign-up/email` (+ `cio-org-id`) | **400** `EMAIL_AND_PASSWORD_SIGN_UP_IS_NOT_ENABLED` |
| H3 | `POST /api/auth/sign-in/anonymous` | **404** |
| H4 | `POST /api/auth/sign-in/social` (google) | **400** `SOCIAL_AUTH_NOT_ENABLED` |
| H5 | `POST /api/auth/sign-in/email` (never-provisioned email — a pending applicant) | **401** `INVALID_EMAIL_OR_PASSWORD` |
| H6 | `GET /public-api/v1/courses` (disabled surface) | **404** (`blockWhenSelfHosted` body) |
| H7 | `GET /organization/automation/keys` (disabled surface) | **404** (`blockWhenSelfHosted` body) |

**Service layer (real fixtures):**

| ID | Attempt | Expected | Result |
|---|---|---|---|
| Q1 | Learner lists the approval queue | 403 | ✅ 403 |
| Q2 | Tutor lists the approval queue | 403 | ✅ 403 |
| Q3 | Learner approves a registration | 403 | ✅ 403 |
| Q4 | Tutor rejects a registration | 403 | ✅ 403 |
| F1 | re-decide an already-approved registration | 409 | ✅ 409 |
| F2 | re-reject an already-rejected registration | 409 | ✅ 409 |
| F3 | approve with a tampered/foreign course id | 404 | ✅ 404 (no account; row stays pending) |
| F4 | double-fire approval on the same pending | one account + one 409 | ✅ one fulfilled, one 409, one account |
| V1 | non-allocated tutor records ID for a learner | 403 | ✅ 403 |
| V2 | learner records their own ID | 403 | ✅ 403 |
| V3 | learner A fetches learner B's staff ID record | 403 | ✅ 403 |
| R1 | registration flood (maxPerWindow+1 from one IP) | 429 | ✅ 429 |

**19 forbidden attempts · 19 refused · 0 breaches.** No account is creatable outside the approved flows (H1–H5);
both disabled integration surfaces are gone (H6/H7).

## 3. E2E narrative (one sitting)

1. **Prospect registers** through the public form → a **pending** `registration` row; **no account** exists yet;
   the org's Manager is notified in-app (`registration.submitted`).
2. **Manager approves, adjusting the course** to the iCQ (DEMO) course → the Phase-5 `onboardLearner` composes
   the account + enrolment + set-password invite; the applicant now has **exactly one** account, is **enrolled**
   in the course (lands in iCQ; Phase-4 locks apply per the course's `sequential_unlock`), the registration
   flips to **approved** with `decided_by/at`, and `registration.approved {registrationId,courseId}` is audited.
3. **The allocated tutor records the ID check** → `id_verification` = verified + method + `verified_by` = the
   tutor; `id_verification.recorded {learnerId,status,method}` is audited (the note stays on the row, never in
   metadata).
4. **The learner sees their own verified status** (verified + date) — the informational line on the id-check unit.
5. **A second application is rejected with a note** → status rejected + note on the row + `registration.rejected`
   audited; **no account** created.

All steps passed (harness `p7s6-e2e.ts`, 0 failures); the set-password invite was observed queuing to Mailpit.

## 4. Suite vs BASELINE

`pnpm vitest run` (apps/api): **448 passed**; 6 test files fail to load — the exact `BASELINE.md` F1 set
(vite/vitest wildcard-subpath resolver quirk on modules that exist in `dist/`). Zero assertion failures; zero
new load-failures. Phase-7 suites: `registration`, `registration-rate-limit`, `registration-decisions`,
`id-verification`, `self-hosted-block`, and the `authz/*` route suites all pass; the Phase-4 unlock tests were
rerun green (ID verification gates nothing).

## 5. Deviations & debts (owner-visible)

- **Un-approvable-row edge case (reviewer-surfaced, criterion 3).** Approve claims the row + runs `onboardLearner`
  inside the transaction, but `onboardLearner`'s writes go through the global `db` client (auth-user creation is
  outside drizzle's tx). If `createOrgUser` succeeds and `addCourseMember` then fails, `onboardLearner` throws 500
  → the tx rolls the registration back to `pending`, **but the account now exists**. Re-approving hits the
  `checkEmailExistsInOrg` duplicate guard and 409s permanently — so **no double-create** (the property claimed
  holds), but the row becomes un-approvable and must be **rejected**, the learner enrolled manually from People.
  This is the disclosed Phase-5 best-effort-tail contract, not a new defect. Ops note.
- **Manager UI reach for recording** — the ID-verification recording control lives on the allocated tutor's
  caseload learner-detail (Admin + allocated Tutor reach it). A Manager can record via the API (guard allows
  Manager/Admin) but has no dedicated learner-record page; a Manager-facing recording surface is a thin
  follow-up, not a gap in the rule.
- **Design-doc path drift (reviewer-surfaced, criterion 7) — FIXED.** `ONBOARDING-MODEL.md` §8 listed the older
  `PUT /organization/learners/:learnerId/id-verification`; the shipped route (and `ACCESS.md` §11, the live
  register) is `/organization/id-verification/learner/:learnerId`. ONBOARDING-MODEL.md §8 corrected this step.
- **Polar UI dead references** — the removed `/api/polar/*` routes are still referenced by three plan-gated
  billing/upgrade UI strings (buy-tokens/portal/subscribe). Self-hosted auto-provisions ENTERPRISE, so those
  surfaces don't render; the strings would 404 if ever reached. Left as-is (removing billing UI is out of scope).
- **Non-deployed apps** — `apps/website` still contains live UserJot/Senja marketing widgets; they are **not
  deployed** (only dashboard/api/jobs ship). Recorded in the egress re-audit, not a live surface.
- **Email delivery** — verified by the gate + observed Mailpit queuing; prod SMTP (AWS SES via the Pearl Email
  Engine) is still the owner's end-of-project step. Unchanged from prior phases.
- **BASELINE F1 load-failures (6 files)** remain by design (pre-existing resolver quirk).

## 6. Independent reviewer subagent

An independent reviewer subagent verified all 8 criteria against the code and **reported 8/8 PASS** (relayed in
full). Its evidence agreed with the direct verification: single create+enrol path (`createOrgUser`+`addCourseMember`
only in `onboarding.ts:74,78`; `decisions.ts:115` calls `onboardLearner`); the one-way compare-and-swap claim;
audit metadata ids/enums only (`decisions.ts:130,171`, `id-verification.ts:103`); the INTEGRATIONS sign-offs (all
✅) vs the live disablements (`v1/index.ts:11`, `automation.ts:25`; `/api/polar/*` absent; `cdn.userjot.com` gone
from the dashboard module) vs the BASELINE egress evidence; no document surfaces around `id_verification`;
ACCESS.md §10/§11 vs the guards; **suite 448 passed, exactly the 6 BASELINE F1 load-failures**.

It surfaced three items for the record, **none a criterion failure** (all captured in §5): the un-approvable-row
edge case (criterion 3 — the disclosed Phase-5 best-effort-tail contract; no double-create); two pre-disclosed
integration leftovers (criterion 5 — the non-deployed `apps/website` UserJot, and three plan-gated dead
`/api/polar/*` UI strings); and the ONBOARDING-MODEL.md §8 stale route path (criterion 7 — **fixed this step**;
ACCESS.md, the live register, already matched the code). No criterion left PARTIAL or FAIL.

## 7. Deploy decision

Intake is now **closed, ordered and audited** — exactly the kind of change worth having live promptly (public
self-signup being shut is a security posture improvement). Production (`learn.epearlacademy.com`) is currently
**held at the Phase-0 commit** pending AWS SES. Redeploying now would advance the droplet to `origin/main` HEAD
(all of Phases 1–7). **Question put to the owner** — redeploy now, or keep holding until SES. If redeploy: update
`docs/DEPLOY.md`'s verified live-hash note; the closed-registration + auth-deactivation code only goes live on a
container rebuild.

## 8. Closing

Phases 6 (comms centre) and 7 (full onboarding & integrations) complete the MVP **fast-follows**. **Phase 10
(hardening & security review)** is next — a whole-codebase sweep (the prompt pack notes `/workflows` for that
phase). The core product (Phases 0–5) + fast-follows (6–7) are done and verified; registration/payment
automation beyond the closed provision-only flow, and any future integration in the register, remain explicit
later decisions.
