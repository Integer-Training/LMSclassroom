# PHASE 1 — Roles & Access: verification report (exit sign-off)

**Verdict: ✅ GO.** Every Phase-1 exit criterion is met with concrete evidence. An independent
reviewer subagent verified the criteria against the repo + suite; an adversarial subagent attacked
the running app with all four role fixtures and achieved **zero** successful forbidden accesses.
Per-role walkthroughs confirm the guards broke nothing legitimate. Reviewed at `main` HEAD
`226ff13f7` (Steps 1–8 committed). Deployment to production is a separate owner decision (see end).

Method: reviewer subagent (static repo + `vitest`), adversarial subagent (curl against the local
api at :3002 with the four fixtures), plus manual per-role walkthroughs (api :3002 + dashboard
:5173) and DB spot-checks via the Supabase MCP. `docs/ACCESS.md` is the matrix of record;
`docs/BASELINE.md` records the two allowed pre-existing test failures (F1, F2).

---

## 1. ACCESS.md complete + §4 gap list closed — ✅ PASS

Every closure in the §4.1 table was code-traced. All Phase-1-critical gaps are closed by the named
guard: A (submission cross-course IDOR) `requireMarkingAccess`+`bindSubmissionToCourse`
(`routes/course/submission.ts`, `guards/ownership.ts`); gradebook-allows-students `requireMarkingAccess`
(`mark.ts`); roster import/assign + course/people escalation `requireAdmin`; cohort D
`requireAdmin`+`requireSameOrg`; quiz E `requireSameOrg` (router-level); dash/community cross-org F
`requireSameOrg`; community body-spoof G (author/org from session); billing I `requireAdminOrApiKey`;
PII team/audience `requireAdmin`; attendance J `requireStaff`. Honestly-documented partials confirmed
as stated: presign H hardened to `requireActor` (deactivation-aware; full per-key bind deferred);
child-id B/C → Phase-2 authoring; link-invite/auto-join → Phase 7; SSO/token-exchange inert
(`requireLicense`, no provider/secret configured). No gap's closure was missing from the code.

## 2. Four-role model + single resolution point — ✅ PASS

`resolveActor` (`packages/db/src/actor.ts`) is the one server-side helper that reads
`organizationmember.roleId` + `profile.status` **fresh per request**, delegating to pure `buildActor`
(`packages/utils/src/auth/actor.ts`) — wired at `app.ts:102`, not from the cookie cache. `buildActor`
denies deny-by-default: anonymous, **DEACTIVATED** (checked before membership), no-membership,
unknown-role. Grep for bypasses found **no** ad-hoc `orgRoles[...]===ROLE.ADMIN` role derivation in
Phase-1 route handlers; the only `orgRoles` reads in `routes/**` are the documented self-authorizing
`hls.ts`/`transcripts.ts` streaming endpoints. *Documented coexistence (accepted debt, not a bypass):*
the legacy cookie-cached role middlewares still guard Phase-2+/deferred surfaces (ACCESS.md §2/§4.1);
deactivation still bites there because status change deletes live sessions and the
`session.create.before` hook blocks re-login.

## 3. API guard coverage sweep — ✅ PASS (0 unguarded)

Full re-enumeration of every endpoint under `apps/api/src/routes/**` (+ app.ts): **~352 endpoints —
333 guarded, 19 intentionally-public, 0 unguarded authenticated endpoints.** The Steps 5–8 additions
(`/organization/users` GET/POST, `/:memberId/role`, `/:memberId/status`, `/:memberId/profile` GET/PUT)
are all `requireAdmin`. No parent router applies a blanket auth gate — deny-by-default holds because
every authenticated route attaches its own guard, and every one does.

## 4. Audit wiring — ✅ PASS (PII-free)

`recordAudit` call-sites verified for the four Phase-1 actions (`services/organization/users.ts`):
`user.created {role}`, `user.role_changed {role_from,role_to}`, `user.status_changed
{status_from,status_to}`, `profile.updated {fields:[names]}` — ids/enums/field-names only, never
email/name/values. Backstop `sanitizeAuditMetadata` strips PII-named scalar values (28-key denylist)
while keeping field-name arrays. Live confirmation across Steps 3/7/8 wrote real rows with clean
metadata (e.g. `profile.updated` recorded all nine changed field NAMES, zero values).

## 5. Closed registration — ✅ PASS

Public account/org creation is off (Step 6, re-confirmed): `emailAndPassword.disableSignUp:true`
(`sign-up/email` → `EMAIL_AND_PASSWORD_SIGN_UP_IS_NOT_ENABLED`), no Google social, `anonymous()`
plugin removed, org self-onboarding 403 on self-hosted, `/signup` → 308 `/login`, no sign-up UI.
Admin `admin.createUser` is the only account door (Step 7).

## 6. Admin user management + PII profile — ✅ PASS

Admin-only user management (list/search, create+invite, role change, deactivate/reactivate) and the
Admin-only PII learner profile (isolated `learner_profile` table) work end-to-end; both fully audited.
PII never appears in the user-list, `/account`, `/account/profile`, logs, or non-admin bundles
(separate-table design + leak sweep, Step 8).

## 7. Effect semantics — ✅ PASS (adversarially verified)

Role change is immediate on the next request with **no re-login** (resolveActor fresh: a live
learner session went 403→200→403 as it was promoted/demoted). Deactivation **bites the live session
immediately** and blocks re-login (below).

## 8. Adversarial pass — ✅ PASS (zero successful forbidden accesses)

Four fixtures against the running app. **40 forbidden attempts → 39 denied outright + 1 by-design
(see note); 0 returned 2xx.**

| Group | What was attempted | Result |
|---|---|---|
| A | Anonymous → 8 authenticated endpoints (users/team/audience/dash/gradebook/cohort/profile/account) | all **401** |
| B | Learner → staff/admin API (users, team, audience, dash, gradebook, cohort-create, org-create, user-create, role-change) | all **403** (org-create 400/403, non-2xx) |
| C | Learner → other users' data incl. **PII** (own + admin + tutor profile GET, status/profile PUT) | all **403** |
| D | Tutor → user management + any learner id incl. marking/submissions (allocation predicate denies) | all **403** |
| E | Manager → config/user-management (users, org PUT, plan, team, profile) | all **403** |
| F | Deactivated learner with a live session: presign 200 → deactivate → same session **401** → re-login **403** → reactivate → login 200 | **PASS** |

**Notes (both benign):** (1) Manager `GET /dash/stats?orgId=<own>` → 200 is **by design** — Manager
has provider-wide *reports* read (`requireManagerOrAdmin`); cross-org scoping holds (`orgId=<foreign>`
→ 403, spoofed header → 401), and Manager stays denied on config/user-management. If the owner wants
Manager to have *no* reports until Phase 5, change `dash/*` from `requireManagerOrAdmin` to
`requireAdmin` — a policy choice, not a defect. (2) Learner `POST /organization` returned 400
(validation) then 403 with a full body — non-2xx either way, denied. Learner fixture reactivated and
confirmed able to log in again; test audit churn removed.

## 9. Per-role walkthroughs — ✅ PASS (guards broke nothing)

Each fixture logs in and its permitted surfaces function normally:
- **Admin** → `/account` 200, `/organization/users` 200, `/organization/team` 200, dashboard
  `/org/lmsctest` 200, `/org/lmsctest/users` 200.
- **Tutor** → login 200, `/account` 200, interim `/welcome` 200, `/lms` 200.
- **Manager** → login 200, `/account` 200, interim `/welcome` 200.
- **Learner** → login 200, `/account` 200, `/lms` 200, `/welcome` 200; active presign 200 (adversarial
  control F2).

## 10. Test suite vs BASELINE — ✅ PASS

`@cio/api` **124 tests pass, 0 assertion failures**; the only failures are the documented **F1** (6
test *files* fail to *load* — the `@cio/core`/`@cio/db` deep-subpath vite-resolver quirk; the three new
`__tests__/authz/*` suites load and pass). `@cio/email` 12 pass, `@cio/question-types` 33 pass. No
regression beyond the pre-existing F1/F2 in `docs/BASELINE.md`.

---

## Findings (non-blocking; no security regressions)

1. **`publicRoute()` marker unused** — the marker is defined/exported (`guards/public.ts`,
   `guards/index.ts`) but applied to none of the 19 public endpoints, so the coverage sweep can't
   *mechanically* distinguish a deliberate public route from an accidental omission. Hygiene only —
   recommend annotating the 19 public endpoints in a later pass.
2. **`POST /course/:courseId/payment-request`** is anonymous by design (course landing-page payment
   request) but triggers an outbound email — a potential abuse/DoS surface flagged in ACCESS.md §4-J.
   Pre-existing ClassroomIO behaviour, out of Phase-1 *roles* scope; worth an explicit owner review
   (rate-limit or gate) in a hardening pass.
3. **Manager reports policy** — `dash/*` is `requireManagerOrAdmin` (Manager provider-wide read). If
   Manager should have *nothing* until Phase 5, switch to `requireAdmin` (see §8 note 1).

## Accepted debts / deferrals (carried forward, owner-acknowledged in prior steps)

- **Legacy cookie-cached role middlewares** persist on Phase-2+/deferred surfaces (ACCESS.md §2/§4.1);
  not a deactivation bypass (session deletion + login-block cover it).
- **presign H** hardened, full per-key ownership bind deferred; **child-id B/C** binding → Phase-2
  authoring; **link-invite/auto-join** self-join → Phase 7; **SSO/token-exchange** JIT inert until an
  admin configures a provider/secret; **dashboard-native** server guards beyond the layout gates are a
  separate follow-up.
- **Prod not yet rebuilt:** Steps 6–8 changed `@cio/db`; the running DO container still serves the
  Phase-0 build, so closed-signup + deactivation + user-management/PII go live only after the
  phase-boundary rebuild (`docker compose -f docker-compose.deploy.yaml up -d --build`). Migration
  0008 (`learner_profile`) is already applied to the shared Supabase.
- **Real prod SMTP** still deferred (owner-planned).

## Deployment decision — pending owner

Phase 1 is stable and locally verified. Redeploying to DigitalOcean (per `docs/DEPLOY.md`, updating
its deployed-commit hash) is the owner's call and requires explicit approval. Because the rebuild
flips production behaviour (closes public signup, enables deactivation + the closed auth model), it
should be done deliberately — recommended after the owner reads this report.
