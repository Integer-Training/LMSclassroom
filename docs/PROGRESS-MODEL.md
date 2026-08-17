# PROGRESS-MODEL.md — Phase 5 progress, completion & lite onboarding (MVP spec)

How the MVP closes: a learner's course progress and completion are **derived from tutor-marked results**,
never self-asserted. A learner sees *their own* progress per course (X of N sessions passed, current
position, completed date once done); Manager and Admin get a provider-wide report; a durable **completion
record** is written the moment a learner's final required result lands; and **lite onboarding** lets an
Admin create a learner + enrol them into a course + issue their credential in one flow.

Compiled 2026-08-17 from the routes/services/schema + an Explore sweep of ClassroomIO's stock completion
machinery (every claim below is file:line-cited). **Step 1 is docs-only — no code changes.**

**Scope fence (do not drift):** no messaging / announcements / notification preferences (Phase 6); no
registration approval, self-registration, ID-verification or external integrations (Phase 7); **no
certificates — ever** (completion is a *record*, not a certificate); no analytics/columns beyond those
specified; no CSV export (noted as a possible later request); no Moodle migration (parked); **no changes to
marking or unlock behaviour.**

---

## ⚠️ OWNER DECISIONS — ✅ CONFIRMED 2026-08-17 (both "do recommended")

> **D1 → confirmed:** completion = ALL non-exempt units passed (robust rule).
> **D2 → confirmed:** hide stock self-asserted completion on the learner surface; ours is the only completion.
> Step 2 proceeds on these.

**D1. Completion rule = ALL non-exempt units passed (RECOMMENDED).** A learner completes course C when
**every non-exempt unit of C has a passing latest marked result** (the Phase-3 `hasLearnerPassedUnit`
helper). Exempt units (induction / ID-check) never receive coursework, so they sit **outside the rule and
outside the denominator**.

- *Literal alternative (not recommended):* "complete when the **final** unit has a passing result." Under
  sequential unlock the two **coincide** — the final unit is only reachable once everything before it
  passed. They diverge **only** for an **unlock-off** course, where the literal rule would let a learner
  complete by passing *only the last session* (skipping the middle). The robust rule is the same under
  gating and correct without it, so it is the one MVP should adopt. **Recommend: confirm the robust rule.**

**D2. Stock self-asserted completion is HIDDEN on the learner surface; ours is the only completion
(RECOMMENDED).** ClassroomIO's stock model lets a **learner self-assert** completion — a "Mark as complete"
button and video-watch auto-complete write `lesson_completion.is_complete`, and progress % is
`completed items / total items` (§5). That competes head-on with "passed only when a tutor records a passing
result." Recommended handling: **hide the stock learner-facing completion/progress indicators and the
self-assert write path on the course-consumption surface, and present our result-derived progress instead**
— *without* rewiring the stock compute functions (they are also consumed by admin/compliance/certificate
code; leaving them intact keeps the blast radius small). Exact surfaces to hide/repurpose are listed in §5.

- *Note this changes inherited UI:* hiding the self-mark control affects the **learner view of every course**,
  not only iCQ (per the "never touch working functions" rule this is flagged, not assumed). The alternative
  (rewire stock `getCourseProgress` etc. to be result-derived) has a much larger blast radius and is **not**
  recommended for MVP. **Recommend: confirm hide-stock + show-ours.**

---

## 1. Completion rule (formal)

For learner **L** and course **C**, `isCourseComplete(L, C)`:

1. Let **U** = the course's units in sequence order (`course_section.order`, then `lesson.order`), filtered
   to **non-exempt** types (type ∉ `GATING_EXEMPT_UNIT_TYPES`; the Phase-4 config).
2. **Complete iff U is non-empty AND `hasLearnerPassedUnit(L, u)` is true for every u ∈ U.**
   (A course with **zero** non-exempt units is *not* completable — nothing to pass; guards against a
   vacuously-complete induction-only course.)

"Passing" comes only from `PASSING_RESULTS` config; "exempt" only from `GATING_EXEMPT_UNIT_TYPES` config —
**no literals anywhere**. The rule is **independent of `sequential_unlock`**: an unlock-off course uses the
exact same "all non-exempt passed" test (D1). Results are immutable in MVP, so completion is monotonic in
practice — but a later Refer on any unit would, by this rule, un-complete the course; the check always
recomputes from live results (no stored "complete" bit is trusted as truth — the record in §2 is a
timestamped *event*, not the source of the boolean).

## 2. Completion record — trigger, storage, idempotency, audit, backfill

**New table `course_completion` (name TBD in Step 2 to avoid collision with the stock compliance
`course_completion_record`, `schema.ts:787`):**
`id uuid pk`, `learner_id uuid→profile`, `course_id uuid→course`, `completed_at timestamptz`,
`created_at timestamptz`. **UNIQUE(learner_id, course_id)** — one completion per learner per course, the
constraint as the durable backstop.

**Trigger (transactional).** Completion is evaluated **inside the same DB transaction** as the result
recording that could satisfy it — i.e. hooked into the Phase-3 `recordResult` marking service
(`apps/api/src/services/coursework/marking.ts`), **after** the result row is written and **only** when the
recorded result is a **passing** value (a Refer can never complete a course, so skip the check). Within that
tx: recompute `isCourseComplete(L, C)`; if true, **idempotent check-and-insert** —
`INSERT … ON CONFLICT (learner_id, course_id) DO NOTHING` — so a re-mark, a concurrent mark, or a
double-fire cannot create a second row or move `completed_at`. **This does not change marking behaviour**
(D-scope): the verdict, feedback, versioning and emails are untouched; completion is an additional write in
the same tx that fails closed with the result if the tx rolls back.

**Audit.** `completion.recorded` via `recordAudit`, **ids only** (`{learnerId, courseId, completionId}`) —
no names, no unit list, no PII. Fired only on an actual insert (not on the idempotent no-op).

**Backfill (one-off).** A one-time script/route (Admin-run, logged) walks **existing enrolments** and, for
each learner+course that already satisfies `isCourseComplete` **through the same rule code** (not a
re-implementation), inserts the completion row idempotently with `completed_at` = the timestamp of the
result that completed it (best-effort: the latest passing result's `recorded_at`; fall back to `now()` only
if indeterminable, logged). Output logged: counts scanned / already-recorded / newly-backfilled. Runs once;
re-running is a no-op via the constraint.

## 3. Progress metrics (one computation, two presentations)

A single server function computes, per (learner, course), over the **non-exempt** units in sequence order:

- **passed** = count of non-exempt units whose **latest marked result is a passing value**
  (`hasLearnerPassedUnit` per unit).
- **total (denominator)** = count of **non-exempt** units. (Exempt units appear in neither numerator nor
  denominator.)
- **current position** = the **lowest-sequence-order non-exempt unit not yet passed** (its title +
  sequence index), or the sentinel **"completed"** when `passed === total` (and total > 0).
- **completed / completed_at** = presence + timestamp of the §2 record (authoritative for the *date*; the
  boolean is reconciled with the live rule — they agree except during the instant before a backfill).

The learner self-view and the Manager/Admin reports **share this one computation** — two presentations of
the same numbers, so a learner and a Manager never see divergent counts. Batched for the report (compute
across many learners in as few queries as the Phase-3 helpers allow; no N+1 per-unit round-trips where a
set-based query serves).

## 4. Stock completion machinery — decision + affected surfaces

Stock completion is **learner self-asserted** (Explore findings, all `apps/dashboard/src/lib/features` +
`packages/db`):

- **Write path (to hide/disable on the learner surface):**
  - "Mark as complete" button + watch ring — `course/components/lesson/content-navigation-actions.svelte`
    (~:154-243); writes `lesson_completion` via `PUT /:lessonId/completion`
    (`apps/api/src/routes/course/lesson.ts:260-293`).
  - Video-watch auto-complete — `course/components/lesson/video/lesson-video-player.svelte` →
    `PUT /:lessonId/watch-progress` (`lesson.ts:320-353`) → `upsertLessonCompletion`
    (`packages/core/src/services/lesson/lesson.ts:626-632`).
- **Read/compute path (leave INTACT — not consumed by our learner surface; used by admin/compliance):**
  `getCourseProgress` (`packages/db/src/queries/course/course.ts:559-654`), `getCourseContentItems.isComplete`
  (`.../content.ts:33-42,77`), `searchLmsCourses.progressRate` (`.../course.ts:985-992`),
  `isExerciseCompletedSql` (`.../progression.ts:24-56`), and client mirrors (`content.ts`,
  `compliance-utils.ts`, `functions.ts`).
- **Learner-visible surfaces to HIDE** (they show stock, self-asserted state that competes):
  1. Per-item green ticks — `course/components/sidebar/course-content-tree.svelte:127-131,179-183`.
  2. Progress ring + "X of N" — `course-progress-popover.svelte`, `course-progress-card.svelte`,
     `course-sidebar-logo.svelte:37-48`.
  3. LMS home progress KPIs — `lms/pages/dashboard.svelte:278-280`.
  4. "In Progress / Complete" bucketing — `lms/pages/mylearning.svelte:13-32`.
  5. Per-course progress bar — `lms/components/learning.svelte:99`.
  6. Completion modal + certificate unlock — `course/components/ceritficate/course-completion-modal.svelte`,
     `.../student-certificate/*`, route `(app)/courses/[id]/certificates` — **hidden for learners** (Phase 5
     ships **no** certificates). With the write path disabled these never fire for iCQ anyway (no
     `lesson_completion` rows), but they are hidden so no stale certificate CTA appears.

**Decision (D2):** hide 1–6 on the learner surface, disable the self-assert write controls, and render our
**result-derived** progress (§3) in their place. The public `(org-site)` course surface persists **no**
completion state today (Explore: no ticks/progress) — confirm it stays that way. Admin authoring and
compliance keep the stock compute functions unchanged.

## 5. Reports spec (Manager / Admin, provider-wide)

- **Payload columns (per enrolled learner, per course):** learner **display name** (the minimum identity),
  **passed / total**, **current position**, **completed?** + **completed_at**. Filterable **by course**.
- **No profile PII.** The report query and serialised payload carry **only** the display name + the metric
  fields above — **never** email, phone, address, DOB, or any Phase-1 extended-profile field. Enforced and
  **tested at the serialisation level** (assert the payload keys are exactly the allow-listed set). The name
  is identity, not a demographic field; everything else is excluded.
- **Manager landing becomes this report** (replacing the current Manager landing). Admin has it too.
- **Access:** Manager + Admin only. **Tutor and Learner are denied** the provider-wide report (a Tutor's
  view of learners stays the Phase-3 allocated caseload; a Learner sees only their own §3 self-view).

## 6. Lite onboarding spec (Admin-only, one flow)

Built on the **existing invite machinery** (no new auth): `createOrganizationMember` +
`createOrganizationInvite` + `enqueueTransactionalEmail('inviteTeacher'/student template)` +
course-id-in-invite-metadata auto-enrol on acceptance (`apps/api/src/services/organization/invite.ts`;
`enrollUsersInCourseGroups` from `@cio/db/queries/group`; `parseCourseIdsFromInviteMetadata`).

**Flow (single Admin action):** enter learner **name + email** + pick a **course** →
1. **Atomically** (one tx): create/find the org member as **STUDENT** (unverified) and create a **course
   enrolment intent** — carried as `courseIds` in the invite metadata, so acceptance auto-enrols exactly the
   way `acceptOrganizationInvite` already does (`invite.ts:408-430`); capacity checked via
   `assertStudentCapacityOrThrow`.
2. **Invite email issues the credential.** The "unique credential" **is their own login**, set by them from
   the tokenised invite link (the existing Better Auth verification flow) — we do **not** mint or email a
   password. Email is content-light (invite link + org branding), audited through the existing invite-audit
   trail (`CREATED` / `EMAIL_SENT` / `EMAIL_FAILED`).
3. **Optional profile PII** (address, DOB, etc.) is captured through the **existing Phase-1 Admin profile
   surface**, *linked not duplicated* — onboarding collects only name + email; richer fields are edited on
   the profile page afterward.

**Duplicate email — graceful** (helpers already exist): `checkEmailsExistInOrg` /
`getActivePendingOrgInviteForEmail`. If the email is already an org member → **do not create a duplicate**;
enrol the existing account into the chosen course (idempotent) and surface a clear "already a member —
enrolled them into <course>" notice. If a pending invite exists → re-send / point at it rather than erroring.
No silent failure, no duplicate user.

**Success state → tutor allocation.** On success, the Admin is pointed at **tutor allocation** for the new
learner (allocation itself remains the **Phase-3 Manager/Admin action**, unchanged — onboarding only links
to it).

**Access:** **Admin only.** Manager / Tutor / Learner are **denied** (tested).

## 7. ACCESS.md rows to add (Step 4/5)

| Surface | Endpoint(s) (new) | Target access |
|---|---|---|
| Learner progress (self) | `GET /course/:courseId/progress` (self) | **Enrolled learner, self only** — `actor.userId` scoped; a learner can never read another learner's progress |
| Completion record (write) | (no endpoint — written inside `recordResult` tx) | server-internal; audited `completion.recorded` (ids only) |
| Provider-wide report | `GET /reports/progress` (course filter) | **Manager or Admin**. Tutor + Learner **denied**. No profile PII in payload |
| Lite onboarding | `POST /organization/onboard-learner` (create + enrol + invite) | **Admin only** |

## 8. Test matrix (Step 2 writes these FIRST — failing — before any implementation)

**Completion-rule truth table** (mock `hasLearnerPassedUnit` + ordered non-exempt units):
- all non-exempt units passed → **complete**; exempt units **ignored** (an all-exempt course → *not*
  complete, empty denominator); one unit unpassed (unmarked / Refer) → **not complete**; **unlock-off**
  course follows the **same** rule; a later Refer un-completes (rule recomputes from live results).

**Completion record / trigger:**
- passing result that finishes the course → **exactly one** row inserted, `completed_at` set; a re-mark or
  double-fire → **still one** row (idempotent `ON CONFLICT`); a Refer result → **no** completion write;
  `completion.recorded` audited with **ids only** (assert no name/PII keys); backfill through the rule code
  is idempotent and logs counts.

**Progress metrics:** passed/total/current-position across positions (first unpassed = position; all passed
= "completed"); exempt units excluded from both; learner-view and report numbers **identical** (same
computation).

**Access / isolation:**
- learner reads **own** progress (200) and **another learner's** progress → **denied** (tested).
- report: Manager/Admin 200; **Tutor denied; Learner denied**; payload serialisation carries **only** the
  allow-listed keys (**no** email/phone/DOB/address — asserted at the serialiser).
- onboarding: Admin creates+enrols+invites; **duplicate email** handled (existing member enrolled, no dup);
  **non-admin denied**.

**MVP end-to-end** (Step 6): a freshly onboarded learner completes a small gated course from invite →
completion row → sees themselves completed → appears completed in the report; plus mid-chain position
spot-checks on iCQ.

## 9. Build order (Steps 2–6, for context)

2. **Test-first:** write the failing rule/metrics/trigger suite (§8); add `course_completion` migration; the
   `isCourseComplete` + progress-metrics functions; hook completion into the `recordResult` tx (idempotent);
   the one-off backfill through the rule code. Suite green. (Plan-mode if the trigger wiring is tangled.)
3. **Learner self-view:** `GET …/progress` (self-only) + the learner progress surface; **hide** the stock
   competing indicators (§4) and disable the self-assert write path on the learner course view.
4. **Reports:** `GET /reports/progress` (Manager/Admin, course filter, no-PII payload); Manager landing
   becomes the report; ACCESS.md rows for progress + report.
5. **Lite onboarding:** Admin create-learner+enrol+invite flow (§6); duplicate-email handling; success →
   tutor allocation; ACCESS.md onboarding row.
6. **Reviewer + adversarial subagents** (learner isolation, report PII, onboarding authz) + MVP end-to-end +
   `docs/PHASE5.md` (MVP summary: what exists, known debts, parked items).

## 10. Verification (this step)

Spot-checks against code (done during the sweep): stock self-mark write path
(`content-navigation-actions.svelte` + `PUT …/completion` `lesson.ts:260-293`); stock progress compute
(`getCourseProgress` `course.ts:559-654`); invite+enrol machinery
(`inviteTeamMembers` / `acceptOrganizationInvite` auto-enrol `invite.ts:408-430`); duplicate-email helpers
(`checkEmailsExistInOrg`). Owner confirms **D1** (completion rule) and **D2** (stock-indicator handling)
before Step 2.
