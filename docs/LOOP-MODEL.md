# LOOP-MODEL.md — Phase 3 core loop (deliver / upload / result / allocation)

How the core loop is built: a learner uploads coursework files against a unit; a tutor (allocated to that
learner) records a **Pass/Refer** verdict + written feedback off-platform; a Refer lets the learner
resubmit (new version, history kept); minimal emails fire both ways; allocation + results are audited.
Compiled 2026-08-14 from a 3-agent code sweep; every claim is file:line-cited. Scope fence: no sequential
unlock/locking (Phase 4), no completion/progress dashboards (Phase 5), no messaging/preferences (Phase 6),
no registration approval (Phase 7), no on-platform marking of content or rubrics (never).

---

## ⚠️ OWNER DECISION — confirm before Step 2

**1. Build NEW coursework tables; do NOT reuse ClassroomIO's `submission`/`exercise`/grading stack.**
The stock stack is structurally quiz-shaped and its marking authz is *course-team-scoped* — the exact
permission model this phase must avoid. Evidence:
- `submission.exercise_id` is **NOT NULL** FK→`exercise` (`schema.ts:594`) — a submission cannot stand
  against a plain unit; you'd have to mint a dummy `FILE_UPLOAD` exercise per unit.
- Grading is **per-question numeric + partly automatic** (`question_answer.point` `schema.ts:1964`,
  `submission.total` `:591`, `scoreSubmissionAnswers`/`requiresManualGrading` from `@cio/question-types`,
  `services/submission/submission.ts:661-703`); "pass" = `total ≥ exercise.pass_threshold` (`schema.ts:1220`).
  There is **no Pass/Refer verdict primitive**.
- Marking authz **reasons in course-team terms**: `isCourseTeamMemberOrOrgAdmin(courseId, …)`
  (`submission.ts:353`) and an all-course-teachers email fan-out (`submission.ts:1036-1057`) — "any course
  tutor can grade any learner in that course" (`ACCESS.md:256`). Reusing this drags the gap back in.
- The stock `submission` is keyed by `submitted_by = groupmember.id` (`schema.ts:595`) with **no
  learner/profile column** — our `actor.userId === submission.learnerId` model can't even be expressed on it.

We **borrow only** the baggage-free pieces (§1): the presign/storage upload+download helpers, the
`enqueueTransactionalEmail` + BullMQ mail plumbing, `recordAudit`, and the Phase-1 guard seam
(`requireMarkingAccess` + `bindSubmissionToCourse` + the `isAllocatedTutor` predicate we now make real).

**2. Result vocabulary comes from config, default `Pass` / `Refer`** (a `RESULT_VALUES` constant like
`UNIT_TYPES`, validator built from it). Configurable set; Phase-4 gating reads a canonical "has passed".

**3. Manager sees NO coursework files or results** (they get states/reports in Phase 5). Coursework file
+ result surfaces = self (learner) OR allocated tutor OR Admin. Manager's only Phase-3 power is **allocation
management** (with Admin).

**4. Allocation is PROVIDER-WIDE** — a `tutor ↔ learner` pair applies across all that learner's courses,
not per-course. (Matches the phase brief; simpler and matches how a tutor owns a caseload.)

---

## 1. Reuse vs new (evidence-backed)

| Stock piece | Decision | Why (file:line) |
|---|---|---|
| `submission`/`exercise`/`question`/`question_answer` + grading services | **NEW** | quiz-bound (exercise_id NOT NULL), numeric/auto grading, course-team authz — see Owner Decision 1 |
| Marking UI (`courses/[id]/submissions`, `marks`) — per-question points grid | **NEW** | verdict+feedback form, not a points grid (`individual.svelte:65-117` sums `answer.point` vs `passThreshold`) |
| **Presign upload/download + file enrichment** | **REUSE** | `generateFileKey`/`generateMaterialFileKey` (`core/utils/upload.ts`), presign routes (`presign.ts`), `generateDocumentDownloadPresignedUrls`, `enrichObjectsWithUrls` — storage-only, no scoring coupling |
| **Email plumbing** | **REUSE** | `enqueueTransactionalEmail` (`api/services/jobs/email-jobs.ts`) → BullMQ worker (`apps/jobs`); content-light templates via `defineEmail` (`packages/email/src/emails/*`) |
| **Audit** | **REUSE** | `recordAudit` + `AUDIT_ACTIONS` (`@cio/db/audit`, `@cio/utils/auth/audit.ts`); schema comment already anticipates "results/allocations" (`schema.ts:3839`) |
| **Guard seam** | **REUSE + fill in** | `requireMarkingAccess`/`bindSubmissionToCourse` (`guards/ownership.ts:68-101`); `isAllocatedTutor` (`utils/auth/ownership.ts:24-28`) becomes real |
| `submission.feedback` text column / `submissionstatus` label table | pattern only | verdict-agnostic ideas, but bound to the quiz pipeline — we model our own |

## 2. New schema (Step 2 migrations)

- **`tutor_allocation`** — provider-wide tutor↔learner pairing.
  `id uuid pk`, `organization_id uuid→organization`, `tutor_id uuid→profile`, `learner_id uuid→profile`,
  `created_by uuid→profile`, `created_at timestamptz`. **UNIQUE(tutor_id, learner_id)**; index on
  `learner_id` and `tutor_id`. **Removal = DELETE the row** (reallocation); `allocation.removed` audited.
- **`coursework_submission`** — a learner's upload against a unit, versioned.
  `id uuid pk`, `learner_id uuid→profile` (= the account user id, so `actor.userId===learner_id` works),
  `course_id uuid→course`, `lesson_id uuid→lesson`, `version int` (1-based per learner+lesson),
  `files jsonb` (`{key,name,size,type}[]`, keys under the coursework prefix — §6), `status varchar`
  (`submitted` → `resulted`), `submitted_at timestamptz`. Index `(learner_id, lesson_id, version)`.
  History retained — rows are never deleted.
- **`coursework_result`** — the tutor's verdict on one submission version.
  `id uuid pk`, `submission_id uuid→coursework_submission` (unique — one result per version),
  `result varchar` (a `RESULT_VALUES` value, default `PASS`/`REFER`), `feedback text`,
  `recorded_by uuid→profile`, `recorded_at timestamptz`. A **Refer** unlocks a new submission version;
  a **Pass** is terminal for the unit. `result.entered` audited.

Config: `RESULT_VALUES` + labels in `packages/utils/src/constants/` (mirrors `unit-type.ts`); `ZResult`
validator built from it. Notification + gating never hardcode `Pass`/`Refer` literals.

## 3. Canonical "has passed" query (Phase 4 consumes — no gating built now)

`hasLearnerPassedUnit(learnerId, lessonId): Promise<boolean>` (db query, tested Step 5): **true iff any
`coursework_submission` for `(learner_id, lesson_id)` has a `coursework_result.result = 'PASS'`** (once a
version passes, the unit is passed). Companion `getLatestUnitResult(learnerId, lessonId)` returns the
result on the highest `version` for tutor/learner display. Phase 4's sequential-unlock will call
`hasLearnerPassedUnit`; **Phase 3 builds and tests it but wires NO gating** (learners still see/submit any
session — correct for now, scope-fenced).

## 4. Access rows to add to docs/ACCESS.md (Step 3/4)

| Surface | Endpoints (new) | Target access |
|---|---|---|
| Coursework submit | `POST /course/:courseId/lesson/:lessonId/coursework` | **Enrolled learner, self, published course** (`isEnrolledLearner` + `isCoursePublished`) |
| Coursework read (metadata + embedded file URLs) | `GET …/coursework` (own) / `GET /caseload/submissions/:id` (tutor) | **self** (`actor.userId===learner_id`) OR **allocated tutor** (`isAllocatedTutor`) OR **Admin**. Manager **NO** |
| Coursework file download | presign download of `coursework/…` keys | same set (self / allocated tutor / Admin), keys bound to that learner's coursework. Manager **NO** |
| Result write (Pass/Refer + feedback) | `POST /caseload/submissions/:id/result` | **allocated tutor** OR **Admin**. Manager **NO** (the `requireMarkingAccess` surface, now allocation-real) |
| Allocation manage | `GET/POST/DELETE /organization/allocations` | **Manager or Admin** (`requireManagerOrAdmin`) |

## 5. How the stock marking-screen permission gaps are AVOIDED (not inherited)

The known gaps (all in `docs/ACCESS.md` §4/§4.1), and how our new flow sidesteps each:
- **Gap A — cross-course submission IDOR** (`ACCESS.md:251-257`): stock services load by `submissionId`
  and never checked `submission.courseId`. *Avoided:* coursework reads/writes load the row and enforce the
  **owner/allocation** predicate on `learner_id` (not a path course), and the tutor path is allocation-bound
  — a tutor with no allocation to that learner is denied at list, detail, and file level.
- **"Any course tutor can grade any learner in the course"** (`ACCESS.md:256`, course-team model): the stock
  service uses `isCourseTeamMemberOrOrgAdmin` (`submission.ts:353`). *Avoided:* our result-write + read
  guards key on `isAllocatedTutor(actor, learner_id)` (provider-wide allocation), **never** course-team
  membership. We do not reuse `services/submission/*` at all, so its course-team check can't leak in.
- **Gradebook-allows-students** (`ACCESS.md:258-261`): *Avoided:* the tutor caseload lists only the actor's
  allocated learners; there is no whole-class endpoint in the coursework flow.
- **Presign gap H — flat capability keys** (`ACCESS.md:342`): *Mitigated the Phase-2 way:* coursework
  download is course+learner-bound via a guard analogous to `assertCourseMaterialDownloadAccess` (verify each
  requested key belongs to a `coursework_submission` the caller may read), not by the opaque key alone.

(The legacy exercise/marking routes remain gated to Admin-only by the Phase-1 deny-stub; they are untouched
and out of the coursework loop.)

## 6. Storage — coursework key scheme (private bucket)

Key: **`coursework/{courseId}/{learnerId}/{lessonId}/{version}/{nanoid}-{filename}`** — learner- and
unit-scoped, mirroring `generateMaterialFileKey`'s style (`core/utils/upload.ts:42`); the `coursework/`
prefix is already reserved + unused (`upload.ts:39`, `COURSE-MODEL.md:118`). Add `generateCourseworkFileKey`.
Access is enforced by the download guard (§4/§5), not the path. Constraints from config (already in place):
content-type allow-list includes `.docx` (`ALLOWED_DOCUMENT_TYPES`, `validation/constants.ts:12-16`); size
from `UPLOAD_MAX_DOCUMENT_MB` (default 5MB, `config/upload-limits.ts`), advisory server-side (bucket policy is
the durable ceiling).

## 7. Notifications (minimal, reuse the mail plumbing)

Two events, via `enqueueTransactionalEmail` (content-light, links built with `getDashboardBaseUrl`):
- **Submission created → the learner's ALLOCATED tutor(s)** (not course teachers). **Edge: no allocated
  tutor → send nothing** (log a warning). New template `courseworkSubmitted` (org, learner display, unit,
  link — no coursework files/feedback in the email).
- **Result recorded → the learner.** New template `courseworkResulted` (`statusText` = the Pass/Refer label,
  a link to view — **no feedback text in the email**; they read it in-app).
Both **toggleable via a config flag** (e.g. `COURSEWORK_EMAILS_ENABLED`); honour the existing per-recipient
email-preference cache. No comms-centre / preferences UI (Phase 6).

## 8. Guards (Step 3, allocation-scoped)

- Make **`isAllocatedTutor(actor, learnerId): Promise<boolean>`** real in `apps/api/src/middlewares/guards/ownership.ts`
  (DB read on `tutor_allocation`: `tutor_id = actor.userId AND learner_id = learnerId AND actor.role='TUTOR'`),
  exactly like `isEnrolledLearner` wraps `isCourseGroupMember`. The pure `@cio/utils/auth` stub can't reach the
  DB; update `requireMarkingAccess:74` to **`await isAllocatedTutor(...)`** (it's already async).
- `canReadCoursework(actor, submission)` = `isSelf(actor, submission.learnerId)` OR (`TUTOR` AND allocated)
  OR `ADMIN`; Manager false. Backs the read + file-download guards.
- Submit guard = enrolled learner + self + published (`isEnrolledLearner` + `isCoursePublished`).
- Allocation manage = `requireManagerOrAdmin`.

## Build order (Steps 2–6, for context)

2. schema (3 tables + `RESULT_VALUES` config + migrations) — plan-mode if the mapping is tangled.
3. allocation table + Manager/Admin UI + real `isAllocatedTutor` + allocation-scoped guards (access-heavy → test-leaning).
4. learner coursework upload (presign under `coursework/…`, versioned) + self-only read.
5. tutor caseload + result/feedback state machine (**test-first**, plan-mode) + `hasLearnerPassedUnit`.
6. minimal emails (both events) + ACCESS.md rows live.
7. reviewer + adversarial subagents + `docs/PHASE3.md`.

## Verification (this step)

Five spot-checks against code (done during the sweep): (1) `submission.exercise_id` NOT NULL
(`schema.ts:594`); (2) grading is per-question points (`question_answer.point` `:1964`, `submission.ts:853-907`);
(3) `isAllocatedTutor` deny-stub (`utils/auth/ownership.ts:24-28`) consumed at `guards/ownership.ts:74`;
(4+5 — the two located marking gaps) cross-course IDOR + course-team-not-allocation (`ACCESS.md:251-257`,
`submission.ts:353`). Owner confirms the four flagged decisions above before Step 2.
