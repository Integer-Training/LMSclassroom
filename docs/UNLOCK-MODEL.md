# UNLOCK-MODEL.md — Phase 4 sequential-unlock spec

How gated delivery works: with a per-course setting ON (as for iCQ), a session is **locked** for a learner
until the previous session has a **passing** result; induction / ID-check units are **exempt**; the lock is
**server-enforced** on every learner-facing content / material / upload endpoint; the outline shows locked
state with a plain hint. Gating applies to **learners only** and is computed **live** from Phase 3's canonical
`hasLearnerPassedUnit` — there is no cached or denormalised lock state anywhere. Locking in the UI is
**presentation over the server refusal, never the control**.

Compiled 2026-08-17 from the routes + `docs/ACCESS.md` + `docs/LOOP-MODEL.md` (endpoint inventory folded in
from an Explore sweep). Scope fence (do not drift): no completion records / progress dashboards (Phase 5), no
"unlocked" notifications (Phase 6), **results stay immutable in MVP** (no edit/correction — noted, not built),
no changes to tutor/marking behaviour, no per-learner overrides or deadlines. **Step 1 is docs-only.**

---

## ⚠️ OWNER DECISIONS — confirm before Step 2

**D1. Exempt units are transparent to the chain (RECOMMENDED).** Exempt-typed units (induction / ID-check)
are **always open** AND **do not participate in the chain**: a gated unit looks back to the nearest preceding
**non-exempt** unit and gates on *that*; exempt units in between are skipped. If there is no preceding
non-exempt unit, the gated unit is **open**. Rationale: an induction / ID-check session never receives
coursework, so if it participated in the chain it would (having no passing result) block the entire course
forever. Transparency is the only coherent semantics. **Recommend: confirm.**

**D2. iCQ exempt-type list = `['induction', 'id-check']`** — drawn from the Phase-2 `UNIT_TYPES` config
(`induction`, `id-check`, `session`, `portfolio-review`), **not hardcoded**. A new `GATING_EXEMPT_UNIT_TYPES`
const lives beside `UNIT_TYPES` in `packages/utils/src/constants/unit-type.ts`. **Recommend: confirm.**

---

## 1. Formal gating rule

For learner **L** and unit **U** in course **C**, `isUnitUnlocked(L, U)` computes **live** (no cached /
denormalised lock state — results are immutable in MVP so unlock is monotonic in practice, but the check always
recomputes):

1. If `C.sequential_unlock` is **off** → **open**.
2. Else if `U.type` ∈ `GATING_EXEMPT_UNIT_TYPES` → **open** (exempt units are always open).
3. Else walk the course's units in **sequence order** (`course_section.order`, then `lesson.order`) and find
   the **nearest preceding unit P whose type is NOT exempt**:
   - none exists → **open** (U is the first gated unit);
   - otherwise → **open iff `hasLearnerPassedUnit(L, P)`** (Phase-3 canonical helper: P's latest *marked*
     version has a configured **passing** result — a later Refer overrides an earlier Pass).

Gating applies to **learners only**; staff are never gated (§6). "Passing" comes only from `PASSING_RESULTS`
config; "exempt" only from `GATING_EXEMPT_UNIT_TYPES` config — no literals anywhere.

**Monotonic-in-practice note:** because results are immutable (no edit/correction in MVP), once P passes it
stays passed, so a unit that unlocks never re-locks. The helper still recomputes on every request — there is no
stored lock bit to drift.

## 2. Config

- **Exempt types:** `GATING_EXEMPT_UNIT_TYPES = ['induction', 'id-check'] as const` in
  `packages/utils/src/constants/unit-type.ts` (beside `UNIT_TYPES`), with an `isExemptUnitType(t)` predicate.
- **Per-course setting:** a new boolean column `course.sequential_unlock` (default **false**; migration in
  Step 2/3), editable **only** through the Admin authoring UI (course settings) — Admin-only like all authoring;
  no other role can toggle it. iCQ has it switched ON through the UI in Step 5.
- **Passing:** reuses Phase-3 `PASSING_RESULTS` / `hasLearnerPassedUnit` — unchanged.

## 3. Canonical helper

`isUnitUnlocked(learnerId, courseId, lessonId): Promise<boolean>` — the **one** gating authority (a new query,
e.g. `@cio/db/queries/gating`). It reads: the course's `sequential_unlock` flag; the unit's type; the course's
units in sequence order with their types (one ordered query); and `hasLearnerPassedUnit` for the resolved
predecessor. **Every** enforcement point (§4) and the outline annotation (§5) call THIS — no parallel lock logic
lives anywhere else.

## 4. Enforcement inventory (the refusal checklist)

Refusal style follows the app's existing content convention: **403** via `forbidden(c, 'Locked — complete the
previous session first')` (the shape used by `requireCourseContentRead` / `requireCourseworkSubmit`); for the
in-handler `assert*` paths, a thrown `AppError(msg, ErrorCodes.FORBIDDEN, 403)` caught by `handleError`. Staff
bypass everywhere (§6); toggle-off / exempt / unlocked units pass through unchanged.

Two enforcement shapes: **REFUSE** (learner gets 403 on a locked unit) and **ANNOTATE** (outline endpoints
return per-unit lock state so the UI can present it). `lessonId` presence decides how the lock is resolved.

| # | Endpoint | file | current guard | lessonId? | Phase-4 action |
|---|---|---|---|---|---|
| 1 | `GET /course/:courseId/lesson/:lessonId` (unit content: body/slides/videos + **embedded material presigned URLs** via `enrichLessonWithPresignedUrls`) | `routes/course/lesson.ts:74` | `requireCourseContentRead` | path | **REFUSE if locked** — also cuts off in-page material URLs |
| 2 | `GET /course/:courseId/lesson/:lessonId/language` + `/language/:locale` (rich text) | `routes/course/lesson-language.ts:30,58` | `requireCourseContentRead` | path | **REFUSE if locked** |
| 3 | `POST /course/:courseId/lesson/:lessonId/coursework/presign` (upload URL) | `routes/course/coursework.ts:28` | `requireCourseworkSubmit` | path | **REFUSE if locked** (add to the guard, beside `isUnitUploadClosed`) |
| 4 | `POST /course/:courseId/lesson/:lessonId/coursework` (create submission) | `routes/course/coursework.ts:41` | `requireCourseworkSubmit` | path | **REFUSE if locked** |
| 5 | `POST /course/presign/document/download` + `/video/download` (standalone material files) | `routes/course/presign.ts:154,200` | `assertCourseMaterialDownloadAccess` | **NO** — body `courseId` + `keys`; key = `materials/{courseId}/…` | **REFUSE if locked**: resolve each material key → owning `lessonId` → `isUnitUnlocked` (non-staff learner). Requires a **key→lessonId map** (extend `getCourseMaterialKeys` in `db/queries/lesson.ts`). Closes ACCESS.md **gap H** for the gating check |
| 6 | `POST /course/:courseId/lesson/download/pdf` (lesson→PDF) + `POST /course/:courseId/download/content` (course→PDF) | `lesson.ts:385`, `course.ts:553` | `courseMemberMiddleware` **only** | to verify | **CONTENT-EGRESS — REFUSE / VERIFY (Step 2):** if the server fetches unit content by id, gate by `isUnitUnlocked` (→ 403 on a locked unit); if it renders only client-supplied body content (the learner already had it), it is not a fresh leak — Step 2 **must** inspect and either gate it or record why not. Not left unverified |
| 7 | `GET /course/:courseId/lesson` (`listLessons`) + `GET /course/:courseId` (`getCourse` → `buildCourseContent` nav tree) — the learner OUTLINE | `lesson.ts:53`, `course.ts:252` | `courseMemberMiddleware` only | per-row lessonId | **ANNOTATE** each unit with `unlocked` + a locked-hint (presentation, §5). **Do NOT refuse** — the learner must see the whole outline |
| 8 | `GET …/coursework` (own list) · `…/coursework/:submissionId` (own detail) · `POST …/coursework/download` (own file) | `coursework.ts:54,77,65` | self-scoped / `canReadCoursework` / `assertCourseworkDownloadAccess` | path/key | **Transitively safe** — a locked unit can hold NO own coursework (submit was refused while locked; unlock is monotonic), so these are naturally empty. No new gate; recorded for completeness |

**Out-of-set** (not content/material/upload; **not gated** this phase, recorded): lesson **comments**
(`GET/POST …/comment`), **watch-progress** / **completion** POSTs, **AI-tutor / summarize**. A learner cannot
reach a locked unit's content page, so these are not a locked-unit *content* leak; a future phase can extend the
same `isUnitUnlocked` gate if wanted. The authoring upload presigns (`POST /course/presign/{document,video}/upload`)
are authoring/exercise uploads (no lessonId, not the coursework loop) — unchanged.

**ACCESS.md cross-check:** every learner content/material/upload row in ACCESS.md (§4.2 content-read +
material-download; §7 coursework submit/read/download) maps to rows 1–5 and 8 above. The endpoint sweep
additionally surfaced rows **6 (PDF egress)** and **7 (outline sources)** — which ACCESS.md does not cleanly
list as learner content rows — and both are given a Phase-4 disposition here (gate/verify, annotate). Step 3/4
updates ACCESS.md to record all of them. **Nothing in the inventory is without a Phase-4 disposition.**

## 5. UI presentation (presentation over the server refusal — never the control)

- **Course outline** lists **all** sessions in order; locked ones are visibly **unavailable** (disabled/greyed,
  lock icon) with a plain hint — **"Locked — complete Session N first"** (N = the resolved predecessor's title).
  Exempt + unlocked sessions render normally. The lock state comes from the **server** (row 7 annotation), never
  computed only in the client.
- **Direct visit to a locked unit** → a graceful **locked page** ("This session is locked. Complete
  *<predecessor>* to unlock it.") rendered when the content load returns the server **403** — the page state is
  backed by the refusal, not a client guess. (The existing client `contentLockReason` notice is cosmetic and
  must never be the only gate.)

## 6. Staff rule

Tutor / Manager / Admin are **never** gated — they read/serve any unit regardless of `sequential_unlock` (they
already bypass the learner content-read / enrolment checks via `isContentStaff`). `isUnitUnlocked` is consulted
**only** for a non-staff enrolled **learner**. Tutor marking behaviour is untouched (tutors mark whatever was
submitted).

## 7. Test matrix (Step 2 writes these FIRST — failing — before any implementation)

**Truth-table unit tests — `isUnitUnlocked`** (mock `hasLearnerPassedUnit` + the ordered-units query):
- toggle **OFF** → every unit open (regardless of results).
- toggle **ON**, first gated unit (no preceding non-exempt) → open.
- toggle **ON**, mid-chain: predecessor **passed** → open; predecessor **not passed** (unmarked / Refer) → locked.
- **exempt unit** (induction / id-check) → always open, AND transparent: a gated unit after
  `[induction(exempt), session A]` gates on **A**, not induction; `[induction, id-check, session B]` with B
  preceded only by exempt units → open.
- **two learners** at different chain positions → independent (L1 unlocked at U3, L2 still locked at U3).
- **computed live** from the Phase-3 passed-helper (no cached bit): flipping the mocked passed-result flips unlock.

**Integration / access tests (per enforcement row):**
- Learner + locked unit → **403** on: content GET (1), language GET (2), coursework presign (3) + create (4),
  material download (5) — **URL/id tampering futile** (a direct `lessonId` or a direct material `key` → still 403).
- **Staff unaffected:** Admin / Tutor / Manager reach every unit on a gated course (200).
- **Toggle-off regression:** a course with `sequential_unlock = false` → every endpoint fully open for the
  learner (no 403 anywhere).
- **Outline annotation:** the outline (7) returns `unlocked` + hint per unit; locked units flagged, exempt +
  unlocked normal.
- **Two-learner independence** end-to-end: L1 (passed Session 1) can open Session 2; L2 (not passed) → 403.
- **PDF-egress (row 6):** Step 2 inspects `POST …/lesson/download/pdf` + `…/download/content` — if they fetch
  unit content server-side, a locked-unit request → 403; if body-only render, a test records the no-leak rationale.

## 8. Build order (Steps 2–5, for context)

2. **Test-first:** write the failing truth-table + integration suite from §7; add config (`GATING_EXEMPT_UNIT_TYPES`)
   + the `course.sequential_unlock` migration; the suite is red before any enforcement code.
3. Implement `isUnitUnlocked`; wire it into every §4 enforcement point + the outline annotation + the key→lesson
   map for material download; the Admin authoring toggle; make the suite green; update ACCESS.md.
4. Reviewer + adversarial subagents against the full enforcement set (URL/id tampering, staff-unaffected,
   toggle-off regression); zero learner reads a locked unit's content/material or submits to it.
5. Switch iCQ's `sequential_unlock` ON through the UI; end-to-end chain walk (fresh learner: induction + first
   gated session open, rest locked; each Pass opens exactly the next session). Evidence in `docs/PHASE4.md`.
