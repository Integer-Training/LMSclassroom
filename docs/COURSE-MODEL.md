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

**Gaps to close in Steps 3–4:**
- **G1 — Authoring is not Admin-only.** The authoring guards are a patchwork; notably **lesson &
  section CRUD are only `courseMemberMiddleware`** (any enrolled member — including a STUDENT — can
  create/edit/delete/reorder): `routes/course/lesson.ts:61,95,107,143`, `section.ts:22,34,52,71,87`.
  Course create is `orgAdminMiddleware` (`course.ts:137`); course/content update is
  `courseTeamMemberMiddleware`. → swap authoring **writes** to **`requireAdmin`** (`middlewares/guards/`).
  ACCESS.md §3b flagged these as Phase-2 work.
- **G2 — No draft/status guard on the learner content path.** `course.is_published`/`status` are
  checked only at *enrolment* (`services/course/invite.ts:649,984`), NOT on lesson read
  (`lesson.ts:72` → `courseMemberMiddleware` + `services/course/access.ts` perform no status check;
  `access.ts:21` even early-returns if the course row is absent). → add a published-course check so a
  **learner** cannot read draft-course content; staff/admin can (to author).
- **G3 — File download is not enrolment-bound.** The legitimate delivery path (the lesson GET already
  embeds fresh 1-hour presigned URLs for each attached document/video via
  `core/utils/lesson-media.ts:125-158`) **is** enrolment-gated. But the standalone
  `POST /course/presign/document|video/download` is `requireActor()` only with caller-supplied `keys`
  — an authenticated but non-enrolled user can fetch any material given the opaque key (the documented
  Phase-1 presign gap H). → deliver materials through the enrolment-bound lesson-GET path, and close
  the standalone download by binding it to a course the caller is enrolled in (require a `courseId` and
  verify each `key` belongs to that course's lessons' `documents`; staff bypass). HLS/transcript
  streams remain org-membership-bound (`hls.ts:124-136`, `transcripts.ts:78-84`) — acceptable for
  Phase 2, noted.

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
