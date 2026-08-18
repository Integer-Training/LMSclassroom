# PHASE5.md — Phase 5 exit sign-off (the MVP is complete)

**Verdict: GO — the MVP is complete.** All eight exit criteria pass, verified independently against the code,
adversarially against the running access layer, and by a whole-MVP end-to-end. Two issues the reviewer
raised were **fixed in this step** (an ACCESS.md documentation gap and a shadowed duplicate route), not
carried. Known debts + parked items are listed in §5; nothing load-bearing is deferred.

Compiled 2026-08-18. Scope: Phase 5 Steps 1–5 — the progress/completion model, durable completion records,
the learner progress view, the Manager/Admin provider-wide report, lite onboarding, and the LMS-home
reconciliation. Localhost + the approved DigitalOcean target only — nothing deployed by this step. Evidence
below is reproducible.

---

## 1. Exit criteria — independent reviewer verdict (8/8 PASS)

An independent reviewer subagent checked each criterion against the actual code (file:line-cited). Overall:
**GO.** Two flags it raised are resolved in §4.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| EC1 | PROGRESS-MODEL decisions match code | **PASS** | `isCourseComplete` (`completion.ts:29-41`) = every non-exempt unit passed; empty-denominator guard; exempt config `GATING_EXEMPT_UNIT_TYPES` (`unit-type.ts:32`) excluded from numerator + denominator; independent of `sequential_unlock`; onboarding composes `createOrgUser` + `addCourseMember` (`onboarding.ts:74,78`) |
| EC2 | One shared progress computation | **PASS** | Learner view, reports, and LMS-home overlay ALL funnel through the pure `computeProgress` (`progress.ts:47-69`); no second "count passed non-exempt" loop for display. (Flag: the display `completed` boolean and the trigger's `isCourseComplete` are two sites of the SAME rule — now cross-linked in code, §4) |
| EC3 | Completion trigger transactional + idempotent + constraint backstop | **PASS** | `recordResult` wraps result-insert + `recordCompletionIfComplete` in `runInTransaction` (`marking.ts:73-91`); evaluated only on a passing result (never Refer); `ON CONFLICT (learner_id, course_id) DO NOTHING`; migration `0013` has `UNIQUE(learner_id, course_id)`; 23505 → 409 |
| EC4 | Backfill through the same rule code | **PASS** | `backfill-completions.ts` → `backfillCompletions` with default deps `isCourseComplete` + `insertCompletionIfAbsent` (same idempotent path); PII-free counts+ids log. Live run recorded in Step 2: scanned 1 / newly 1 / re-run 0 |
| EC5 | Audit coverage | **PASS** | `completion.recorded` ids-only, fired only on a genuine insert (`marking.ts:111-119`); onboarding adds NO new action (composes → `user.created`); `docs/AUDIT.md` documents the Phase 3–5 actions + the onboarding note |
| EC6 | Stock-indicator surfaces handled | **PASS** | Course view: mark-complete + video-watch + per-item ticks + progress ring/card/popover hidden for the learner (Step 3); LMS home: `overlayResultDerivedProgress` wired in `GET /organization/courses/enrolled` so KPIs / My-Learning buckets / course-card bars read result-derived progress. No second learner-visible "complete" state |
| EC7 | ACCESS.md rows live | **PASS** (fixed this step) | Reviewer found the rows ABSENT; §9 added to `docs/ACCESS.md` — learner progress (self), provider-wide report (Manager/Admin, no PII), lite onboarding (Admin) |
| EC8 | Suite vs BASELINE.md | **PASS** | `apps/api` `NODE_ENV=test npx vitest run` → **329 tests pass, 0 assertion failures**; the only 6 failing FILES are exactly the documented BASELINE **F1** resolver-quirk set (`agent-lesson-content`, `ai-credits-usage`, `balance-answer-positions`, `course-go-live-readiness`, `question-update`, `reset-member-course-progress`) |

## 2. Adversarial pass — zero successful forbidden accesses

An adversarial subagent mounted the **real** `reportsRouter` + `usersRouter` in-process with forged
ADMIN/MANAGER/TUTOR/LEARNER/anon actors against the live DEMO fixtures, and probed every forbidden path.
**0 breaches across 16 checks.** PII absence proven on the wire (not just the UI).

| Attempt | Result |
|---|---|
| LEARNER → `GET /reports/progress?courseId=DEMO` | **403** ✓ |
| LEARNER → `GET /reports/progress/courses` | **403** ✓ |
| TUTOR → `GET /reports/progress?courseId=DEMO` | **403** ✓ |
| TUTOR → `GET /reports/progress/courses` | **403** ✓ |
| MANAGER → `POST /users/onboard` | **403** ✓ (and **0** user rows created for the probe email — denied before any write) |
| MANAGER → `GET /users/onboard/courses` | **403** ✓ |
| LEARNER → `POST /users/onboard` | **403** ✓ |
| LEARNER → another learner's progress by id tampering | **impossible** ✓ — `getOwnCourseProgress(actor, courseId)` has no learnerId param; the id is structurally `actor.userId` |
| ANON → reports (both) + onboarding (both) | **401** ✓ |
| MANAGER report payload — profile PII on the wire | **no leak** ✓ — demo.learner's real `profile.fullname/username/email` never appear; `name` comes from the `user` table; row keys exactly `{learnerId, name, passed, total, completed, completedAt, currentPosition}` |

## 3. Whole-MVP end-to-end (service-level; the browser onboarding + first login is the owner's manual step)

A fresh enrolled learner (as lite onboarding produces) was walked through the entire journey on the DEMO
gated course (2 non-exempt units S3/S4; induction + id-check exempt). **24/24 checks pass**, state cleaned up.

1. **First login** — with iCQ gating ON, the learner sees induction + id-check + the first gated session
   (S3) **open**, portfolio review (S4) **locked**. ✓
2. **Unit 1** — uploads S3 coursework; the allocated tutor marks **Refer** with feedback → S3 not passed, S4
   stays locked, **no** completion. ✓
3. **Resubmit** — learner resubmits (v2); tutor marks **Pass** → S3 passed (latest-marked wins), S4
   **unlocks**, still no completion (S4 outstanding). ✓
4. **Mid-chain spot-check** — learner progress = **1 of 2**, current position = S4 (the 2 exempt units are
   excluded from the denominator — the iCQ position/denominator check). ✓
5. **Final unit** — uploads S4; tutor marks **Pass** → the **completion row** + the **`completion.recorded`
   audit row** (ids only) appear, written in the marking transaction. ✓
6. **Learner sees completed** — progress = 2/2, completed = true, with a completion **date**. ✓
7. **Manager report agrees** — the learner shows **completed with the same date**; the report's passed/total
   and date are **identical** to the learner view (one shared computation). ✓
8. **LMS home agrees** — the enrolled-courses overlay shows **2 of 2 = 100%** (the My-Learning Complete
   bucket picks it up). ✓

Completion, progress, and reports all agree.

## 4. Issues raised & resolved this step

- **FIXED — shadowed duplicate route.** The Step-3 learner endpoint was registered as
  `GET /course/:courseId/progress`, colliding with the pre-existing stock `getCourseProgress` route (which
  takes `?profileId`). Hono dispatched the first match, so the stock route was shadowed and the stock caller
  (`course.svelte.getProgress`) silently received the actor's own self-view. **Renamed** the learner endpoint
  to `GET /course/:courseId/learner-progress` (+ the client store + the ACCESS.md row); the stock route is
  restored.
- **FIXED — EC7 ACCESS.md gap.** The three Phase-5 rows were never transcribed. Added as ACCESS.md §9.
- **ADDRESSED — completion boolean in two sites.** `computeProgress.completed` and the trigger's
  `isCourseComplete` are the same rule in two places (intentional — the trigger needs an in-transaction
  short-circuit). Cross-linked in code with a "change both" note; both compose the same primitives.

## 5. MVP summary — what exists, known debts, parked

### Capabilities now live (Phases 0–5)
- **Phase 0** — ClassroomIO hard-fork, docs (CODEMAP/ENV/ACCESS/BASELINE), baseline suite.
- **Phase 1** — four-role model (Admin / Manager / Tutor / Learner); Admin user management (create, role,
  deactivate); Admin-only learner enrolment PII; shared `audit_event` trail (ids/field-names, no PII values);
  **closed** registration (provision-only, no public self-sign-up).
- **Phase 2** — course authoring; configurable unit types (`induction`, `id-check`, `session`,
  `portfolio-review`); content model.
- **Phase 3** — the coursework loop: provider-wide tutor↔learner allocation, versioned learner uploads, the
  tutor caseload (allocated-only), Pass/Refer marking with feedback (Refer→resubmit→Pass), the canonical
  `hasLearnerPassedUnit`, content-light notification emails.
- **Phase 4** — per-course sequential unlock (Admin toggle, default off); exempt-transparent gating
  (induction/id-check skipped); server-enforced on every content/material/upload endpoint; live-computed.
- **Phase 5** — result-derived progress + durable completion records (transactional, idempotent, audited,
  backfilled); the learner progress view; the Manager/Admin provider-wide report (no profile PII); lite
  onboarding (create learner + enrol + credential in one Admin flow); LMS-home reconciled to one notion of
  progress.

### Known debts
- **6 pre-existing test-file load failures (BASELINE F1)** — a vitest wildcard-subpath resolver quirk;
  running tests all pass. Documented in BASELINE.md.
- **Branding** — ClassroomIO branding/strings remain (see `docs/TODO-BRANDING.md`).
- **Email delivery** — content-light emails are wired to BullMQ but need AWS SES/SMTP credentials to actually
  send in production; localhost uses the dev mailer.
- **Real iCQ content** — the live 25-session iCQ course is a data task (the DEMO 4-unit course is the proxy
  used for all verification).
- **Results immutable in MVP** — no edit/correction of a recorded result (a Refer on a later version is the
  correction path); noted, not built.
- **Onboarding atomicity boundary** — `createOrgUser` spans Better Auth + our DB, so it is not a single
  transaction; mitigated by up-front course validation + the duplicate-email 409 before any write. A failure
  in the enrolment insert after account creation surfaces an actionable message (Phase-3 rule).
- **Completion boolean in two code paths** — cross-linked, not deduplicated (§4).
- **laserlearning archive import** — decision still open (owner-deferred).

### Parked items (by design)
- **Phase 6** — messaging / announcements / notification preferences.
- **Phase 7** — registration approval, self-registration, ID-verification, external integrations.
- **Phase 10** — workflow orchestration.
- **Phases 8–9 — Moodle migration — parked by design.**
- **Certificates — never** (completion is a durable record, not a certificate).

## 6. Deploy recommendation

The MVP is stable, verified, and green. **Recommend redeploying to DigitalOcean now** so the owner can walk
the learner journey against the deployed URL. This needs the owner's **explicit approval** — nothing is
deployed by this step. If approved: follow `docs/DEPLOY.md`, update its deployed-commit hash to this commit,
and have the owner repeat the §3 learner journey once on the DigitalOcean URL (onboard → set credential →
first login → coursework → Refer → resubmit → Pass → completion → progress → report).

_Test-first statement: the completion rule + progress metrics were authored as failing tests before the
implementation (Steps 2–3); the reviewer independently re-derived the guarantees from the code, and the
adversarial pass + whole-MVP E2E confirm them end-to-end._
