# PHASE2.md — Phase 2 exit sign-off (Courses, authoring & iCQ entry)

**Verdict: GO for Phase 3**, with one owner-acknowledged deferral (the *real* iCQ course
content is not yet written, so the qualification was proven through a labelled DEMO course, not
entered for real). Every other exit criterion passes, verified independently against the code and
the running app.

Compiled 2026-08-14. Scope: Phase 2 Steps 1–5 (course model, schema + enrolment predicate,
Admin-only authoring, guarded materials, course entry). Localhost only — nothing deployed by this
step. Evidence below is reproducible.

---

## 1. Exit criteria — independent reviewer verdict (8/8 PASS)

An independent reviewer agent checked each criterion against the actual code (not the docs).
Summary with representative evidence:

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| EC1 | COURSE-MODEL.md mapping matches code | **PASS** | course=`course` (`is_published` schema.ts:730 + `status` :762); phase=`course_section` (:294); unit=`lesson` (`section_id` :1028, `order` :991, `unit_type` :1036); materials = `lesson_language.content` + `lesson.documents` + `lesson.links` (:1027); enrolment=`groupmember` |
| EC2 | Ordering = single source of truth | **PASS** | only `course_section.order`/`lesson.order` exist; grep found **no** rival field (`sequence_order`/`sortOrder`/`orderIndex`/`position`) on lesson/section; dashboard reorder routes through the pure `reindexOrder` helper (clean 0-based bijection) |
| EC3 | Type labels only from config | **PASS** | one `UNIT_TYPES` const + `ZUnitType` validator; grep for `'induction'`/`'id-check'`/`'portfolio-review'` hits **only** the config file + the UI select that imports it — no stray literals |
| EC4 | Authoring Admin-only (G1) | **PASS** | every write in course/section/lesson/content/lesson-language routes uses bare `requireAdmin`; none still use `courseMemberMiddleware`/`courseTeamMemberMiddleware`; two automation-key routes keep their scoped guard (documented residual) |
| EC5 | Content read guarded (G2) | **PASS** | `requireCourseContentRead` on lesson GET + lesson-language GETs → `canReadCourseContent` (staff OR enrolled-AND-`is_published`+`status='ACTIVE'`); a learner on a **draft** course is denied |
| EC6 | Material download bound (G3) | **PASS** | presign downloads call `assertCourseMaterialDownloadAccess` (401 anon / staff-only when no courseId / content-read + current-material currency for a learner); uploads namespaced `materials/{courseId}/…`; **no** public base-URL for `documents`/`videos` (only `media`); handlers surface real status via `handleError` |
| EC7 | ACCESS.md rows live & accurate | **PASS** | §4.2 marks authoring/publish/content-read/material-download CLOSED with the exact guard names traced in EC4–EC6 |
| EC8 | Test/build integrity | **PASS** | `lesson.links` = migration `0010`; the four new authz/reorder test files exist and assert the criteria |

Full reviewer notes and line-cited evidence are archived from the review run; the deviations it
raised are carried into §5 below.

## 2. Adversarial spot-pass — zero successful forbidden accesses

Live against the running app with real fixtures (Admin, Tutor, Manager, Learner test accounts, plus
anonymous). Every forbidden attempt was denied:

```
AUTHORING WRITES (demo course)          TUTOR   MGR   LEARN   ANON
POST   /lesson            (create unit)   403   403    403    401
POST   /section           (create phase)  403   403    403    401
PUT    /lesson/:id        (edit unit)     403   403    403    401
DELETE /lesson/:id        (delete unit)   403   403    403    401
PUT    /course/:id        (publish)       403   403    403    401
POST   /lesson/:id/language (rich text)   403   403    403    401

UNENROLLED LEARNER on a course they aren't in:
  GET draft course lesson list ................... 403
  GET draft course detail ........................ 403
  presign-download (material key + foreign courseId) 403

ANONYMOUS raw bucket object:
  raw S3 GET ..................................... 403
  raw public-object GET .......................... 400
```

Denials come from the guard layer (requireAdmin / requireCourseContentRead /
assertCourseMaterialDownloadAccess), and the private buckets reject unauthenticated access. No
learner can reach another learner's or another course's content.

## 3. Smoke checks — nothing regressed

- **Enrolled learner reads Session 1 materials:** `GET …/lesson/:id` → `success:true` with the
  attached file (key under `materials/…`) + the labelled link + `unitType:"induction"`;
  `GET …/lesson/:id/language` (rich text) → 200. All three material kinds render for the enrolled
  learner (confirmed in the browser too — the learner delivery screen shows the phases, sessions and
  Session 1's rich text).
- **Admin authoring action:** `PUT …/lesson/:id` (edit title) → 200.

## 4. iCQ / course-structure cross-check (clean)

The real iCQ course is deferred (no content yet — see §5). The authoring mechanism was proven with a
labelled **DEMO** course entered through the real authoring endpoints; the read-only cross-check:

```
session_count = 4   phase_count = 2   null_orders = 0   distinct_type_labels = 4

phase 0  Phase 1 - Getting started   session 0  Session 1 - Welcome & induction   [induction]
phase 0  Phase 1 - Getting started   session 1  Session 2 - Identity check        [id-check]
phase 1  Phase 2 - Delivery          session 0  Session 3 - Core delivery         [session]
phase 1  Phase 2 - Delivery          session 1  Session 4 - Portfolio review      [portfolio-review]
```

Count exact, order contiguous with no gaps, type labels on exactly the intended sessions, phase
grouping correct. When the real 25-session iCQ list arrives, the same flow + the same cross-check
apply (session count 25, order 1..25, induction on Session 1, portfolio-review on Session 25).

## 5. Test suite

`@cio/api` vitest: **171 tests pass**, 0 assertion failures. 6 test *files* fail to load — these are
the **documented pre-existing F1** failures in docs/BASELINE.md (a vite/vitest resolver quirk with
`@cio/core`'s wildcard subpath exports + `@cio/db/queries/notifications`; the target files exist and
the full build is green). Baseline api count was 72 → now **171**: at/above baseline, **no
regressions** beyond the documented F1 set.

## 6. Deviations & accepted debts

- **[Deferred — owner-acknowledged] The real iCQ Level 5 course is not entered.** No course content
  exists yet. The authoring flow + guards + cross-check were proven with a labelled DEMO course
  (`DEMO - Example course (safe to delete)`, currently published for the owner's walkthrough; safe to
  delete). `docs/AUTHORING.md` is the staff guide to enter the real course when the 25-session list is
  ready. **This is the one open item at the phase boundary.**
- **[Accepted debt] Material *upload* presign is `requireActor()`, not Admin-only.** The
  `POST /course/presign/{document,video}/upload` endpoint is shared with non-material uploads (exercise
  submissions, org assets), so it can't be blanket Admin-gated without breaking learner coursework.
  Impact is bounded: an uploaded object only becomes a learner-retrievable *material* after an
  **Admin-only** `PUT …/lesson/:id` attaches its key, and download is currency-bound (a key not in the
  course's current materials is 403). This is the documented Phase-1 presign gap **H** ("HARDENED, full
  bind deferred"); a proper per-purpose split is Phase-3+ coursework work.
- **[Cosmetic] COURSE-MODEL.md line-number citations drift a few lines** from the current schema.ts
  (entities/columns all correct). Not blocking.
- **[Note] DEMO artifacts in the shared DB:** the demo course + test accounts
  (demo.learner / demo.tutor / demo.manager) are runtime records for the walkthrough, not committed to
  git. Deletable on request.

## 7. Recommendation

**GO for Phase 3.** The course model, Admin-only authoring, canonical ordering, config-driven type
labels, and guarded material serving are all in place, code-verified, adversarially tested, and at/above
the test baseline. The only carry-forward is entering the *real* iCQ content (a data task, not an
engineering gap) plus the two accepted debts above.

**Deploy question (owner's call):** Phase 2 is stable — redeploy to DigitalOcean now, or hold? If yes,
follow docs/DEPLOY.md with explicit approval and update its deployed-commit hash. (SMTP/AWS SES is still
scheduled for the end, so a redeploy now carries the same set-password-email caveat noted in earlier
phases.)
