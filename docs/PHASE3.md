# PHASE3.md — Phase 3 exit sign-off (the coursework loop)

**Verdict: GO for Phase 4.** Every exit criterion passes, verified independently against the code and
adversarially against the running access layer. One low-severity latent flag the reviewer raised (an
org-scoping gap on the allocations router) was **fixed in this step**, not carried. Two owner-facing
items remain (email SMTP delivery + browser walkthrough need the mail stack running; the *real* iCQ
content is still a data task) — neither is an engineering gap.

Compiled 2026-08-17. Scope: Phase 3 Steps 1–6 — tutor↔learner allocation, versioned learner coursework
upload, tutor caseload, result/feedback marking (Pass/Refer + refer→resubmit→pass), and two minimal
content-light notifications. Localhost + the approved DO target only — nothing deployed by this step.
Evidence below is reproducible.

---

## 1. Exit criteria — independent reviewer verdict (7/7 PASS)

An independent reviewer subagent checked each criterion against the actual code (file:line-cited, not the
docs). Overall: **GO**. Summary with representative evidence:

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| EC1 | LOOP-MODEL decisions match code (incl. stock-gap avoidance) | **PASS** | 3 purpose-built tables — `tutorAllocation`/`courseworkSubmission`/`courseworkResult` (`schema.ts:3902/3943/3980`); the coursework services import **zero** stock-marking code (grep of `services/coursework/*` for `isCourseTeamMemberOrOrgAdmin\|services/submission\|scoreSubmissionAnswers` → no matches); `hasLearnerPassedUnit` = `isPassingResult(getLatestMarkedResult(...))` (`coursework.ts:209`), latest-**marked**-version semantics matching LOOP-MODEL §3 |
| EC2 | Predicates are the ONLY access path to coursework | **PASS** (flag → fixed) | `canReadCoursework`/`requireCourseworkSubmit`/`assertCourseworkDownloadAccess`/`isAllocatedTutor` (`ownership.ts`); caseload roster sourced **only** from `tutor_allocation` (`listLearnersForTutor`/`listAllocatedLearnersForOrg`); `getSubmissionsWithContextForLearners` early-returns `[]` on empty ids (never widens); `getCaseloadLearnerDetail` re-checks `isAllocatedTutor`; `listOwnCourseworkForUnit` self-scoped to `actor.userId`. Reviewer flag on the allocations org-scope — **fixed** (§5) |
| EC3 | Config is the single source for result values / limits / toggle | **PASS** | `'PASS'`/`'REFER'` literals appear only in `constants/result.ts` + tests (grep); `ZResult = z.enum(RESULT_VALUES)`; upload from `getUploadLimits()` + `ALLOWED_DOCUMENT_TYPES` (no hardcoded byte/type lists); `courseworkEmailsEnabled()` reads `COURSEWORK_EMAILS_ENABLED` at call time in one place (`notifications.ts:17`) |
| EC4 | Audit coverage + compliant metadata (no PII / no feedback) | **PASS** | `result.entered` = `{submissionId, version, result}` w/ inline "NEVER the feedback text" (`marking.ts`); `allocation.created/removed` = ids; `coursework.submitted` = ids+count; PII-key sanitiser backstop (`audit.ts:61`) |
| EC5 | Emails content-light (no coursework / feedback / result / PII) | **PASS** | both template Zod schemas carry **no** result/feedback field; render bodies interpolate only course+unit title + link; subjects generic (no learner name) |
| EC6 | ACCESS.md rows live & guard names real | **PASS** | ACCESS.md §7 guard names all verified against the route wiring (allocation `requireManagerOrAdmin`; submit `requireCourseworkSubmit`; read `requireActor`+self / `canReadCoursework`; download `assertCourseworkDownloadAccess`; caseload/result `requireStaff` + allocation re-check) |
| EC7 | Test suite vs BASELINE.md | **PASS** | 251 running tests pass, 0 assertion failures; the only 6 failing *suites* are exactly the documented F1 resolver set — no new failures (§5) |

Reviewer's one flag (EC2): the allocations router scoped from the raw `cio-org-id` header with no
`requireSameOrg` binding — non-exploitable under the enforced single-org model, but a cross-org vector if
multi-org were ever enabled. **Fixed this step** (§5). No FAILs; no PII/feedback leakage in audit, emails,
or query surfaces.

## 2. Adversarial pass — zero successful forbidden accesses

Two tutors (A allocated to learner A, B allocated to learner B), two learners, a manager, and
anonymous — every forbidden access driven directly against the guard/service decision layer with known
ids, plus real unauthenticated HTTP probes and a raw-bucket URL. **0 breaches across 24 forbidden
attempts** + 4 HTTP-boundary probes. Full log:

```
=== NON-ALLOCATED TUTOR (tutorB) against learnerA (allocated to tutorA) ===
tutorB caseload injection (learnerA must not appear) -> roster EXCLUDES the foreign learner
tutorB -> learnerA caseload detail ................... 403
tutorB -> learnerA submission detail ................. 403
tutorB -> learnerA file download ..................... 403
tutorB -> mark learnerA submission ................... 403
=== LEARNER A against learner B's work ===
learnerA -> learnerB submission detail ............... 403
learnerA -> learnerB file download ................... 403
learnerA -> own-list on B's unit (self-scoped) ....... empty / self only (no B data)
=== LEARNER against marking endpoints ===
learnerA -> mark own submission ...................... 403
learnerB -> mark A submission ........................ 403
=== MANAGER against marking / submission-file / caseload ===
manager -> mark submission ........................... 403
manager -> file download ............................. 403
manager -> submission detail ......................... 403
manager -> caseload detail ........................... 403   (service-level, post-fix §5)
manager -> caseload list ............................. 403   (service-level, post-fix §5)
=== UNAUTHENTICATED (forged anon actor) ===
anon -> file download ................................ 401
anon -> mark submission .............................. 401
anon -> caseload detail .............................. 401
anon -> caseload list ................................ 401
anon -> submission detail ............................ 403
anon -> own list ..................................... 401
=== REPLAY / NON-LATEST marking ===
tutorA -> re-mark an already-marked version .......... 409
tutorA -> mark a NON-latest (superseded) version ..... 409
=== RAW BUCKET (unsigned object URL) ===
anon raw bucket GET (no signature) ................... 403

=== UNAUTHENTICATED HTTP probes (running api :3002) ===
GET  /caseload ....................................... 401
GET  /caseload/learners/<uuid> ....................... 401
POST /caseload/submissions/<uuid>/result ............. 401
GET  /course/<c>/lesson/<l>/coursework ............... 401

==== PASS: 0 breaches ====
```

Denials come from the shared predicates (`canReadCoursework` / `isAllocatedTutor` / `assertCourseworkDownloadAccess`
/ `requireStaff` / `requireCourseworkSubmit`) + the marking service's own allocation re-check; the private
`documents` bucket rejects unsigned access. No learner can reach another learner's submission, result,
feedback or file; no non-allocated tutor can reach an unallocated learner; a Manager gets no coursework.

## 3. Full-loop E2E — the complete loop, once

Driven through the **real services** (allocation service → coursework service → marking service), with the
audit trail asserted. All steps PASS:

```
manager allocates learner -> tutor ................... allocation.created audited
learner uploads v1 ................................... coursework.submitted audited; tutor notification enqueued
tutor marks v1 REFER (+ feedback) .................... result.entered audited; learner notification enqueued
  -> not passed, upload still OPEN (resubmit allowed)
learner resubmits v2 ................................. coursework.submitted audited
tutor marks v2 PASS .................................. result.entered audited; learner notification enqueued
  -> learner HAS PASSED the unit
  -> upload CLOSED for the unit (canSubmit = false)
history: both versions present, both feedbacks intact
audit actions: { allocation.created:1, coursework.submitted:2, result.entered:2 }  — NO feedback text in any metadata
```

**Notifications:** the two events fire at the service layer (verified enqueued). Their **content-path** was
independently verified in Step 6 — real recipients resolved (tutor + learner emails), template fields valid
against the registered Zod schemas, rendered HTML carries course+session+link and **no** result value /
feedback text / file / learner name; subjects generic. **Actual SMTP delivery to Mailpit is the one part not
exercised here** — it needs Redis + the `apps/jobs` worker + Mailpit running (see §6, owner check).

## 4. Test suite

`@cio/api` vitest: **251 tests pass, 0 assertion failures.** 6 test *files* fail to load — exactly the
documented **BASELINE F1** set (the vite/vitest resolver quirk with `@cio/core`'s wildcard subpath exports +
`@cio/db/queries/notifications`): `agent-lesson-content`, `ai-credits-usage`, `balance-answer-positions`,
`course-go-live-readiness`, `question-update`, `reset-member-course-progress`. Baseline api count was 72
(BASELINE.md) → Phase 2 172 → **now 251**: well above baseline, **no regressions** beyond the F1 set. Every
Phase-3 suite passes (`marking`, `result-config`, `coursework-notifications`, `coursework-notify-nonfatal`,
`authz/coursework-*`, `authz/caseload-*`, `authz/allocation-*`).

## 5. Fixes applied this step (from the review + adversarial pass)

- **[Fixed] Allocations router trusted the `cio-org-id` header** (reviewer flag). `routes/organization/allocations.ts`
  now derives `orgId` from the **resolved actor** (`actor.orgId`), never a client-supplied header — a
  Manager/Admin can only ever act on their own org's allocations. Non-exploitable before (single-org is
  enforced), but now header-proof and consistent with the caseload/coursework paths.
- **[Fixed] Caseload services are now self-defending.** `getTutorCaseload` and `getCaseloadLearnerDetail`
  (`services/caseload/caseload.ts`) previously relied on the route's `requireStaff` to keep Managers out —
  the service functions themselves let a non-(Admin|allocated-tutor) fall through. Both now deny anyone who
  is not an Admin or an allocated tutor (defense-in-depth; surfaced by driving the adversarial pass at the
  service layer). No behaviour change for legitimate callers; the caseload/allocation test suites stay green.

## 6. Deviations & accepted debts

- **[Owner check — infra, not code] Email SMTP delivery + browser walkthrough.** The enqueue is wired and the
  email content-path is verified (§3), but actual delivery to Mailpit and the click-through UI loop need the
  mail stack up (Redis + `apps/jobs` worker + Mailpit) and a browser. Recommended owner spot-check: run the
  loop as `demo.tutor` / `demo.learner`, confirm the tutor email on submission and the learner email on
  marking land in Mailpit, and that the learner sees Pass + a closed uploader.
- **[Deferred — carried from Phase 2] The real iCQ Level 5 course is not entered.** The whole loop was proven
  against the labelled DEMO course + demo fixtures. Entering the real 25-session content is a data task
  (`docs/AUTHORING.md`), gated on the owner's staff finishing it — the standing open item at the phase boundary.
- **[Accepted debt — carried] The stock `submission`/`exercise`/`mark` marking stack is untouched and unused**
  by the coursework loop (it keys on allocation, never course-team membership), so its known gaps (ACCESS.md
  §4 A / gradebook / course-team) cannot leak in. Its legacy routes remain Admin-only from Phase 1.
- **[Note] Manager UI reachability.** The allocation API is `requireManagerOrAdmin`, but the admin shell is
  Admin-only, so today only an Admin reaches the allocation UI. The API already permits Managers for when a
  manager surface is built (a later phase). Flagged at Step 2; unchanged.
- **[Note] DEMO artifacts in the shared DB** (demo course + demo.learner/tutor/manager) are runtime records
  for the walkthrough, not committed to git; deletable on request. All Phase-3 E2E/adversarial runs seed and
  clean up their own rows.

## 7. Recommendation

**GO for Phase 4.** The core loop — allocation, versioned upload, caseload, Pass/Refer marking with
refer→resubmit→pass, upload-closed-on-pass, the canonical passed-helper, and content-light notifications —
is in place, code-verified (7/7 exit criteria), adversarially clean (0 breaches / 24+ forbidden attempts),
and above the test baseline. The one reviewer flag was fixed, not carried. The carry-forwards are a data task
(real iCQ content) and an owner infra spot-check (Mailpit delivery) — neither an engineering gap.

**Deploy question (owner's call):** Phase 3 is stable — **redeploy to DigitalOcean now, or hold?** If yes,
follow `docs/DEPLOY.md` with explicit approval and update its deployed-commit hash. SMTP/AWS SES is still
scheduled for the end, so a redeploy now carries the same set-password-email + coursework-notification
"enqueued-but-not-delivered-until-mailer-wired" caveat as earlier phases (functionally fine; emails simply
don't leave until the mailer is configured in prod).
