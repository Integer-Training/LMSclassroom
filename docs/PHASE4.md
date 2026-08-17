# PHASE4.md — Phase 4 exit sign-off (sequential unlock)

**Verdict: GO for the next phase.** All six exit criteria pass, verified independently against the code
(file:line-cited) and adversarially against the running guard/service layer with a real gated course.
Zero learner successes on locked units. One real scope flag the reviewer raised (quiz *exercise*
endpoints tied to a lesson are not gated) is **carried as a documented owner decision**, not silently
resolved — it sits outside UNLOCK-MODEL §4's written inventory, which reserves it for a future phase.

Compiled 2026-08-17. Scope: Phase 4 Steps 1–4 — the sequential-unlock spec (`docs/UNLOCK-MODEL.md`),
the config + migration + canonical `isUnitUnlocked` helper + server enforcement on every learner-facing
content/material/upload endpoint (test-first), the learner-facing lock UI, and switching iCQ's toggle on
through the authoring UI. Localhost + the approved DO target only — nothing deployed by this step.
Evidence below is reproducible.

---

## 1. Exit criteria — independent reviewer verdict (6/6 PASS)

An independent reviewer subagent checked each criterion against the actual code (file:line-cited, not the
docs). Overall: **GO (with one documented-scope flag)**.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| EC1 | UNLOCK-MODEL decisions match code | **PASS** | `isUnitUnlocked(courseId, lessonId, learnerId)` (`ownership.ts:170-181`) implements §1 in exact order: toggle-off→open (`:171`); exempt→open (`:176`); no non-exempt predecessor→open (`:178-179`); else gate on `hasLearnerPassedUnit` of the resolved predecessor (`:180`). D1 transparency + D2 exempt list (`['induction','id-check']`, `unit-type.ts:32`) both match |
| EC2 | Enforcement inventory matches reality | **PASS** (1 scope flag) | Rows 1–8 of §4 each carry the check or are correctly annotate/no-leak (see §3). Flag: quiz `exercise.ts` GET/POST ungated — outside §4's documented inventory (§4 debt below) |
| EC3 | Single gating path, no cached lock state | **PASS** | Exactly one `isUnitUnlocked` (`ownership.ts:170`) + one `getCourseUnlockMap` (`services/gating/unlock.ts:20`), both composing the pure `findGatePredecessorIndex` (`packages/utils/src/constants/unit-type.ts:45`). Only stored state is `course.sequential_unlock` boolean — no per-unit lock column; unlock recomputed live each call. Client store only reads the server map (`api/unlock.svelte.ts`), no chain recompute |
| EC4 | Config is the single source for exempt/passing | **PASS** | `GATING_EXEMPT_UNIT_TYPES`/`isExemptUnitType` only in `constants/unit-type.ts:32-37`; `PASSING_RESULTS`/`isPassingResult` only in `constants/result.ts`. Grep of `apps/api/src` for `induction`/`id-check`/`PASS`/`REFER` literals → matches only under `__tests__/`, none in production gating/guard/service/route code |
| EC5 | Toggle admin-only, default off | **PASS** | Migration `0012_chemical_joseph.sql`: `ADD COLUMN "sequential_unlock" boolean DEFAULT false NOT NULL`; `ZCourseUpdateBase.sequentialUnlock: z.boolean().optional()`; persisted only via `PUT /course/:courseId` guarded `requireAdmin` (`course.ts:335-337`); authoring Switch on the settings page. No other role/route can set it |
| EC6 | Test-first + no baseline regressions | **PASS** | 282 running tests pass, 0 assertion failures; the only 6 failing *suites* are exactly the documented BASELINE F1 resolver set — none are Phase-4 (§5) |

No FAILs. The reviewer raised one scope flag (EC2) and one minor note (EC1 fail-open on a foreign
lessonId) — both dispositioned in §4.

## 2. Adversarial pass — zero learner successes on locked units

A mid-chain learner fixture (`demo.learner`, enrolled, **S3 not passed** → S4 locked) was driven directly
against the **real mounted guards** and services on the real gated DEMO course
(`fe8aa888…`, `sequentialUnlock` toggled **ON** for the run), plus staff fixtures. The only DEMO material
sits on the exempt S1 induction unit, so a **temporary material was added to the locked S4 unit** for the
download test and **removed on cleanup**; the toggle was returned to **OFF**. Every attempt logged.
**0 breaches across 19 checks.**

| Attempt (mid-chain learner vs locked S4) | Result |
|---|---|
| content `GET` S4 (locked) | **403** ✓ |
| coursework submit `POST` S4 (locked) | **403** ✓ |
| material download, S4 material key (locked) | **403** ✓ |
| `isUnitUnlocked(S4, learner)` | **false** ✓ |
| URL/id tamper — content GET with S4 id directly | **403** ✓ |
| replay — submit against S4 id | **403** ✓ |
| **positive** content GET S3 (first gated, open) | 200 ✓ |
| **positive** submit S3 (open) passes guard | 2xx ✓ |
| **positive** content GET S2 (id-check EXEMPT, deep in course) | 200 ✓ |
| **positive** content GET S1 (induction EXEMPT) | 200 ✓ |
| unlock map exposes ONLY `{unlocked, lockedByTitle}` (no content/materials/keys smuggled) | ✓ |
| locked S4 content GET returns 403, no body | ✓ |
| **staff** admin content GET S4 | 200 ✓ |
| **staff** tutor content GET S4 | 200 ✓ |
| **staff** manager content GET S4 | 200 ✓ |
| **staff** admin material download S4 key | allowed ✓ |
| **staff** unlock map S4 `unlocked=true` | ✓ |

**Chain-walk end-to-end (real services, learner + tutor fixtures):** fresh state → S3 open, S4 locked;
manager allocates tutor → learner submits S3 → **tutor marks S3 Pass** → S4 opens (each Pass opens exactly
the next); **toggle-off regression** → S4 open regardless. 3/3 PASS. State cleaned up after.

## 3. Enforcement inventory — row-by-row against the code

- **Row 1** `GET /course/:courseId/lesson/:lessonId` — `requireCourseContentRead`; non-staff gated via
  `isUnitUnlocked` on the path lessonId (`ownership.ts:200-204`). Embedded material presigned URLs cut off
  with it. ✓
- **Row 2** `GET …/lesson/:lessonId/language` + `/:locale` — both `requireCourseContentRead`. ✓
- **Rows 3/4** `POST …/coursework/presign` + `POST …/coursework` — both `requireCourseworkSubmit`; guard
  adds the `isUnitUnlocked` gate (`ownership.ts:310-313`). ✓
- **Row 5** `POST /course/presign/{document,video}/download` — `assertCourseMaterialDownloadAccess`
  resolves each `materials/…` key → owning lesson via `getMaterialKeyLessonMap` → `isUnitUnlocked` for
  non-staff (`ownership.ts:256-262`). ✓
- **Row 6 (PDF egress)** `POST …/lesson/download/pdf` + `…/download/content` — handlers render **only
  client-supplied body content** (`generateLessonPdf/CoursePdf(validatedData)`); no `getLesson`/`getCourse`/
  `buildCourseContent` fetch-by-id, so no locked-unit content is read server-side. **No leak** — the doc's
  §4 row-6 verify obligation is discharged with the no-leak rationale. ✓
- **Row 7 (outline)** `GET /course/:courseId/lesson`, `GET /course/:courseId`, and the dedicated
  `GET /course/:courseId/unlock` → `getCourseUnlockMap` — annotate, never refuse; same shared rule. ✓
- **Row 8** own-coursework list/detail/download — self-scoped / `canReadCoursework` /
  `assertCourseworkDownloadAccess`; transitively safe (a locked unit holds no own coursework). ✓

## 4. Deviations & debts (carried, not hidden)

- **DEBT-P4-1 — quiz *exercise* endpoints are not gated (owner decision).** `GET /…/exercise/:exerciseId`
  (`exercise.ts:113`) and `POST /…/exercise/:exerciseId/submission` (`exercise.ts:284`) are tied to a
  `lessonId` but guarded only by `courseMember`/`course:exercise:read` — **not** `isUnitUnlocked`. A learner
  could fetch a locked lesson's quiz by exerciseId. This is **outside UNLOCK-MODEL §4's documented
  inventory**, which scopes gating to lesson *unit* content, materials, and coursework (the iCQ
  apprenticeship model has **no quiz exercises** in its gated units) and explicitly reserves "a future phase
  can extend the same `isUnitUnlocked` gate if wanted." Recorded here for the owner to confirm the scope, or
  to schedule as a follow-up gate. **Not exploited by the iCQ course** (no exercises on its units).
- **NOTE-P4-2 — fail-open on a foreign lessonId.** `isUnitUnlocked` returns `true` when the lessonId is not
  in the course's ordering (`ownership.ts:175`). Only reachable for a lessonId not belonging to the course —
  which the content-read/enrolment layer already rejects — so not a gating bypass. Left as-is; noted.

Nothing else was left unverified.

## 5. Test suite vs BASELINE.md

`apps/api`, `NODE_ENV=test npx vitest run` → **282 tests passing, 0 assertion failures**. The only failing
*suites* are exactly the documented BASELINE **F1** resolver-quirk set (six files that fail to *load* under
the vitest resolver; no assertions run): `agent-lesson-content`, `ai-credits-usage`,
`balance-answer-positions`, `course-go-live-readiness`, `question-update`, `reset-member-course-progress`.
**No new failures; none are Phase-4.**

Phase-4 suites, all passing (written **before** the implementation, per the test-first mandate):
`unlock-helper.test.ts` (full truth table — toggle-off, exempt-always-open + transparent, first-gated-open,
unpassed/Refer→locked, passed→unlock, two-learner independence, live-from-passed-helper),
`authz/unlock-enforcement.test.ts` (content/submit/material refuse + tamper-futile + staff-unaffected +
toggle-off for all three guards), `unlock-authoring.test.ts` (exempt config, boolean validation,
PUT-is-requireAdmin, PDF-no-leak), `unlock-map.test.ts` (staff all-open, toggle-off, mid-chain
lockedByTitle, unlock-on-pass).

## 6. Test-first statement

The Phase-4 test matrix (UNLOCK-MODEL §7) was authored as failing tests in Step 2 before any helper, guard,
or route change; implementation followed to green. The reviewer confirmed the suites exist and pass, and
independently re-derived the enforcement inventory against the code rather than the docs.

## 7. Owner-facing items

- **DEBT-P4-1 (exercise scope)** — confirm quiz exercises are intentionally outside the iCQ gated model, or
  schedule the follow-up `isUnitUnlocked` gate.
- **Deploy** — recommend **Hold** (localhost only; no production deploy until the mail stack + AWS
  SES/SMTP land at phase end, per the standing plan). `docs/DEPLOY.md` unchanged.
