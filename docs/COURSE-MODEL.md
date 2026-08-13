# COURSE-MODEL.md — ClassroomIO content model → PearlLMS (Phase 2 design)

How ClassroomIO's existing course/lesson/section machinery maps to PearlLMS courses, phases, units
and materials — so Steps 2–4 **extend rather than rebuild**. Compiled 2026-08-13 from a 3-agent code
sweep; every claim is file:line-cited. Scope fence: no submissions/marking (Phase 3), no allocation
(Phase 3), no unlock-gating logic (Phase 4 — we only store the type labels now), no completion
(Phase 5), no SCORM/H5P, no assessment-criteria mapping.

---

## ⚠️ OWNER DECISION — how the 8 phases + 25 sessions map (confirm before Step 2)

ClassroomIO ships a `course → course_section → lesson` hierarchy (the section layer is optional,
toggled per course via `course.metadata.isContentGroupingEnabled`).

- **CHOSEN (recommended) — reuse both existing levels:** **phase = `course_section`** (8 sections),
  **session/unit = `lesson`** (25 lessons, one per session, each holding that session's materials).
  Reuses the existing section + lesson authoring, ordering, and content editor; the only schema
  addition is one `type` column on `lesson`. This follows the phase brief's own hint ("if ClassroomIO
  has a section/module level, map phases onto it").
- Alternative considered — flat lessons + a `phase` group-label column (no sections): slightly lighter
  DB, but discards the existing grouping UI + section ordering and reuses less. **Not chosen.**

Everything below assumes the chosen mapping.

---

## 1. Entity mapping (reused vs extended)

| PearlLMS concept | ClassroomIO entity | Reuse / extend | Evidence |
|---|---|---|---|
| **Course** (qualification/programme) | `course` | **reuse** | `schema.ts:640`; draft/publish = `is_published` (`:730`) + `status` text `'ACTIVE'` (`:762`) |
| **Phase** (8 groupings) | `course_section` | **reuse** | `schema.ts:288`; `order` bigint (`:294`), `course_id` FK |
| **Unit / session** (25) | `lesson` | **reuse** (+1 column) | `schema.ts:971`; `section_id` FK → course_section (`:1025`), `order` (`:991`) |
| **Materials — rich text** | `lesson_language.content` (per locale) | **reuse** | `schema.ts:1772`; TipTap editor `packages/ui/src/custom/editor/editor.ts` |
| **Materials — files** | `lesson.documents` jsonb `{type,name,link,size,key,assetId}[]` | **reuse** | `schema.ts:1015`; + `assets` table (`:1046`) |
| **Materials — links / embeds** | TipTap links/iframe in `lesson_language.content` (or a `documents` entry `type:'link'`) | **reuse** | editor `toolbar-commands.ts` (Link, iFrame) |
| **Type label** | *(new)* `lesson.unit_type` nullable | **extend** | see §3 |
| **Enrolment** (learner ↔ course) | `groupmember` in the course's `group` (`course.groupId`) | **reuse** | `isUserCourseMemberOrOrgAdmin` `queries/group/group.ts:142` |

Cohorts (`cohort` / `cohort_course` / `cohort_member`, `schema.ts:3027+`) are a **separate**
cross-course grouping of learners — NOT the per-course enrolment record; out of scope for Phase 2.

## 2. Ordering — REUSE the existing `order` columns (one source of truth; nothing added)

A canonical `order` bigint already exists on both levels, and reorder writes it directly (no
array/JSON/linked-list):
- **Phase order** = `course_section.order` (`schema.ts:294`); reorder `POST /course/:courseId/section/reorder`
  (`routes/course/section.ts:87` → `reorderCourseSections`, `core/services/course/section.ts:222`).
- **Session order within a phase** = `lesson.order` (`schema.ts:991`); reorder
  `POST /course/:courseId/lesson/reorder` (`routes/course/lesson.ts:61` → `reorderLessons`,
  `core/services/lesson/lesson.ts:222`, which can also move a lesson between sections).
- Learner-facing global order is composed at read time: sort by `course_section.order`, then
  `lesson.order` (`packages/db/src/queries/course/public-course.ts:164,179,230-245`).

**Decision:** a unit's canonical `sequence_order` = **`lesson.order`** (its order within its phase);
the phase order = `course_section.order`. The global 25-session sequence is the tuple
`(course_section.order, lesson.order)`. **No new ordering field is added** — this reuses the existing
one source of truth per level. Phase 2 will ensure `lesson.order` is populated as the iCQ sessions
are entered.

**Step 2 verification (order coherence):** the only pre-existing rows were 3 Phase-0 test lessons with
null `order`; they were backfilled to a contiguous 0-based sequence per `(course_id, section_id)` via
`row_number()`. Post-backfill there are **0 null `lesson.order` values**, so the
`(course_section.order, lesson.order)` tuple is well-defined for every existing unit.

## 3. Type label — new nullable column, allowed values from config

- **Column:** `lesson.unit_type` — a nullable `varchar` (a session may carry no special type). Added in Step 2.
- **Allowed values come from config, not hardcoded literals:** a shared constant `UNIT_TYPES` in
  `packages/utils/src/constants/` (e.g. `unit-type.ts`) with the expected values
  **`induction`, `id-check`, `session`, `portfolio-review`**, reused by the Zod validator (built from
  the constant), the authoring UI select, and later Phase 4. Phase 2 **only stores** the label; Phase 4
  reads exemptions against these values (no gating logic now — scope fence).

## 4. Materials — what exists vs the gap list

**Already exists (reuse):**
- **Rich text:** TipTap editor (headings, lists, tables, math/KaTeX, colour, links, images, video,
  audio, iframe embeds, markdown), saved per-locale to `lesson_language.content` via
  `POST /course/:courseId/lesson/:lessonId/language`.
- **File attach:** `add-document-modal` → `POST /course/presign/document/upload` → browser PUT to
  storage → key stored in the `assets` table and appended to `lesson.documents`, persisted by
  `PUT /course/:courseId/lesson/:id`.
- **Storage is already the private Supabase buckets.** The code is S3-generic
  (`packages/core/src/config/storage.ts`, `utils/s3.ts`), but PearlLMS points `OBJECT_STORAGE_*` at
  Supabase Storage's S3-compatible endpoint (Phase-0 Step 6). `documents` + `videos` are **private**
  (reachable only via 1-hour presigned GET); `media` is public. No storage code change is needed.

**Gap-closure status:**
- **G1 — Authoring not Admin-only — CLOSED (Step 3).** All course/unit/phase authoring writes → `requireAdmin`.
- **G2 — No draft/status guard on the learner content path — CLOSED (Step 4).** A new
  `requireCourseContentRead` middleware (`middlewares/guards/ownership.ts`) applies `canReadCourseContent`
  on the material reads — `GET …/lesson/:lessonId` and `GET …/lesson/:lessonId/language[/:locale]` — so a
  learner enrolled in a **draft** course is denied (staff bypass; the stock `assertEnrolledStudentContentAccess`
  fail-open on a missing course is now moot).
- **G3 — Download not enrolment-bound — CLOSED (Step 4).** The standalone
  `POST /course/presign/{document,video}/download` now takes a `courseId` and runs
  `assertCourseMaterialDownloadAccess`: no `courseId` ⇒ staff-only (org-asset path); with `courseId` ⇒ the
  content-read rule, and for non-staff every `materials/…` key must be a **current** material of the course
  (removed/cross-course keys are 403). The learner delivery path (lesson-GET embedded 1-hour URLs via
  `core/utils/lesson-media.ts`) stays the primary channel and is now also G2-gated. HLS/transcript streams
  remain org-membership-bound (Phase-2-acceptable; noted).

## 4a. Material model (Step 4)

A unit's materials are three kinds, all authored by Admin and served only to enrolled learners of a
published course (or staff):
- **Rich text** → `lesson_language.content` (TipTap, per locale); served via the now-gated lesson-language GET.
- **Files** → `lesson.documents` jsonb `{type,name,link,size,key,assetId}` + the private `documents`
  bucket. Uploaded via `POST /course/presign/document/upload`; the learner's `link` is freshly presigned
  server-side on each gated lesson GET.
- **Links** → `lesson.links` jsonb `{label,url}[]` (new column, migration `0010`) — labeled external links,
  plain metadata (no stored object), rendered as clickable labels on the gated read.

**Object key scheme (clean room for Phase 3):** material uploads are namespaced
**`materials/{courseId}/{nanoid}-{filename}`** (`generateMaterialFileKey`, `core/utils/upload.ts`) — reserve
**`coursework/{courseId}/{learnerId}/…`** for Phase 3 learner submissions (not built). The prefix is
organizational; access is enforced by the guarded download (current-material set), not the key path. The
shared presign endpoint stays non-breaking: non-material document uploads (e.g. exercise submissions) omit
`courseId` and keep the flat legacy key.

**Delete / replace = tombstone-by-dereference.** Removing a material overwrites `lesson.documents` (or
`lesson.links`) without the entry — learner access is revoked immediately (no longer embedded on the gated
lesson GET; the currency-bound download 403s for that key). The private storage object is **orphaned**
(unreachable via the guarded path once dereferenced). Actual S3 deletion stays the assets subsystem's job
(`deleteAssetService` — usage-gated, best-effort background); no S3 delete is triggered by a lesson edit.
Replace = delete + add (no in-place). 

**Upload constraints (config-driven).** Content-type is **server-enforced** via `z.enum(ALLOWED_DOCUMENT_TYPES)`
(pdf/doc/docx) / `ALLOWED_CONTENT_TYPES` (video) on the presign upload — a disallowed `fileType` is rejected.
Size comes from `@cio/utils/config/upload-limits` (`UPLOAD_MAX_DOCUMENT_MB`, default 5MB; env-overridable) and
is enforced **advisory** server-side (client-reported `fileSize`); the durable ceiling is the Supabase bucket
policy. No public base-URL exists for `documents`/`videos` (only `media`) — no unauthenticated shortcut.

## 5. Access rows to add to docs/ACCESS.md (Steps 4/6)

| Surface | Endpoints | Target access |
|---|---|---|
| **Course authoring** | `POST /course`; `PUT`/`DELETE /course/:id`; lesson + section + content CRUD/reorder; `PUT …/lesson/:id/language` | **Admin only** (write). Tutor/Manager/Learner denied. |
| **Course publish** | `PUT /course/:id` (`is_published`) | **Admin only** |
| **Lesson/session content read** | `GET /course/:courseId/lesson/:lessonId` | **Enrolled learner** (course group member) **OR any staff**; for learners, **published courses only** (G2) |
| **Material download** | lesson-GET embedded presigned URLs; `POST /course/presign/*/download` | Enrolled-in-that-course learner **OR staff**, key bound to the course (G3) |

---

## Reuse vs extend — one-line summary

**Reuse:** the `course` / `course_section` / `lesson` tables and their `order` columns; the TipTap
editor + `lesson_language` rich text; `lesson.documents` file attachments + presign upload; the private
Supabase buckets; `groupmember` enrolment + `isUserCourseMemberOrOrgAdmin`; the existing
course/section/lesson authoring routes and dashboard components.
**Extend:** add one `lesson.unit_type` column (config-driven values); tighten authoring guards to
`requireAdmin` (G1); add a published-course guard on learner content reads (G2); bind material
download to course enrolment (G3); relabel section→"phase" / lesson→"unit/session" in the authoring UI.

## Verification (spot-checks, done)

`course_section.order` / `lesson.order` exist (`schema.ts:294,991`); `lesson.documents` jsonb holds
file attachments (`:1015`); enrolment = `isUserCourseMemberOrOrgAdmin` (`group/group.ts:142`);
lesson/section CRUD guarded only by `courseMemberMiddleware` (`lesson.ts`, `section.ts`); standalone
presign download is `requireActor()` only (`presign.ts:183`). Owner confirms the OWNER DECISION mapping
before Step 2.
