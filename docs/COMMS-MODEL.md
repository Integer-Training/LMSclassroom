# COMMS-MODEL.md — Phase 6 comms centre spec

How communication moves inside the platform: **allocation-bound tutor↔learner messaging**, **staff
announcements** (course-scoped or provider-wide), an **in-app notification centre** unifying every event,
the two Phase-3 emails folded into **one notification framework**, and **per-user notification preferences**
with quiet defaults. Emails stay **content-light everywhere** — they announce and link, never carrying a
message body, feedback, or files.

Compiled 2026-08-18 from three Explore sweeps (stock comms machinery, notification touchpoints, schema +
access) — every claim below is file:line-grounded. **Step 1 is docs-only — no code changes.**

**Scope fence (do not drift):** no attachments/file-sharing in messages (text only — submissions are the
ONLY coursework channel); no learner↔learner messaging; no forums/Q&A/group chats/community beyond
announcements; no message edit/delete (immutable — note as a possible later request); no digest engine (the
coalescing rule IS the quiet behaviour); no realtime/websocket infra beyond what stock runs (stock runs
**none** — the centre is poll/refresh); no SMS/push; no registration comms (Phase 7); **no changes to
marking / unlock / completion behaviour.**

---

## ⚠️ OWNER DECISIONS — ✅ ALL FOUR CONFIRMED 2026-08-18 ("do all recommended")

> **D1 → confirmed (refined at Step 5):** announcement posters = **Admin + Manager only, for BOTH provider-wide AND course-scoped** (`requireManagerOrAdmin`). **Tutors are denied entirely** — a course-scoped announcement still broadcasts to ALL enrolled learners of that course (not just a tutor's allocated ones), which is against the tutor-scoping principle; a tutor's outreach channel is messaging their allocated learners. Announcements are **publish-immediate** — no drafts, no scheduling (noted as possible later requests). A course announcement's notification goes to the learners enrolled **at publish time**, but the announcement itself stays visible on the course surface to anyone who enrols later.
> **D2 → confirmed:** Admin can read any thread (silent oversight, never posts); Manager excluded.
> **D3 → confirmed:** one message email per thread while unread (+ config window); email defaults coursework/message ON, announcement/session OFF (in-app always).
> **D4 → confirmed:** pair-bound threads; a new tutor = a fresh thread, the old goes read-only; same pair reactivates.
> Step 2 proceeds on these.

**D1. Announcement posters = Admin + Manager (RECOMMENDED).** Provider-wide announcements → **Admin or
Manager** (`requireManagerOrAdmin`); course-scoped announcements → **course staff** (Admin/Tutor,
`requireStaff`). **Tutors do NOT broadcast provider-wide** — broadcasting would reach non-allocated learners,
against the tutor-scoping principle; a tutor's outreach channel is messaging their *allocated* learners.
**Recommend: confirm.**

**D2. Staff visibility of message threads = Admin can open any thread; Manager cannot (RECOMMENDED).** Admin
already has everything in the role model, and provider accountability wants oversight of correspondence. A
**Manager cannot** read threads (consistent with Phase 3, where Manager sees no coursework files/results —
Manager gets states/reports, not content). **Trade-off, stated plainly:** message threads are private
correspondence; giving Admin read-any-thread is a genuine privacy reduction for accountability's sake — the
participants are the tutor + learner, and Admin is a silent third reader (never a participant, cannot post).
If you'd rather Admin also be excluded (participants-only, nobody else ever), say so and messaging becomes
strictly two-party. **Recommend: Admin read-only oversight; Manager excluded.**

**D3. Coalescing rule + per-category email defaults (RECOMMENDED).** *Coalescing:* **one message email per
thread while it has unread messages** — when a new message arrives, send the email only if the recipient has
NO already-unread messages in that thread (i.e. they've read up to now), OR a **config backstop window**
(`NOTIFICATION_COALESCE_WINDOW_MS`) has elapsed since the last message email for that thread. Bursts collapse
into one email; the in-app notification **always** writes. *Category email defaults (all in config,
`NOTIFICATION_EMAIL_DEFAULTS`):* coursework submission **on**, coursework result/feedback **on**, message
**on**, announcement **off** (in-app only), session-unlocked **off** (in-app only). **Recommend: confirm.**

**D4. Reallocation = pair-bound threads; a new tutor starts a fresh thread, the old goes read-only
(RECOMMENDED).** A thread is bound to the **(tutor_id, learner_id) pair**, never to `tutor_allocation.id`
(reallocation DELETEs the allocation row — a FK cascade would destroy the whole conversation). On
reallocation to a **different** tutor: the old thread (old pair) is **archived → read-only** for its
participants (and Admin per D2); the new tutor is a **different pair → a fresh thread**. Re-allocating the
**same** pair after a gap **reactivates** the existing thread (history is valuable and there is no privacy
reason to sever it). Writability is a **live** `isAllocatedTutor` re-check at send time + a non-archived
thread — never a stored grant. **Recommend: confirm.**

---

## 1. Event catalogue (the five events)

Every event runs through the ONE framework (§2): it **always** writes an in-app notification to each
recipient, and sends an email **only** per the recipient's preference for that category (config default when
unset). Emails are content-light (title/link only).

| Event | Fires when | Recipient(s) | In-app | Email category (default) | Coalesce |
|---|---|---|---|---|---|
| `submission.created` | a learner submits coursework | the learner's **allocated tutor(s)** | always | coursework (**on**) | none (per submission) |
| `result.recorded` | a tutor records Pass/Refer | the **learner** | always | coursework (**on**) | none (per result) |
| `message.received` | a message is posted to a thread | the **other participant** | always | messaging (**on**) | **per-thread** (D3) |
| `announcement.published` | staff publish an announcement | learners matching scope (enrolled or all) | always | announcement (**off**) | none (in-app only) |
| `session.unlocked` | a gated session unlocks for a learner (Phase-4 rule flips) | the **learner** | always | session (**off**) | none (in-app only) |

Recipient rules key on existing predicates: allocated-tutor via `listTutorsForLearner`
(`queries/allocation/allocation.ts:108`); learner = the submission/result's `learnerId`; announcement scope =
`course_id` null → all in org, else enrolled learners (`isEnrolledLearner`); `session.unlocked` is emitted
when a Pass changes `isUnitUnlocked` for the next non-exempt unit (computed, not stored — the emit hooks the
same `recordResult` transaction that already recomputes unlock).

## 2. The one notification framework

**Shape:** a single `emitNotification({ type, recipientId, entityType, entityId, emailTemplate?, emailFields?,
coalesceKey? })` server helper that:
1. **Always** inserts a `notification` row for each recipient (the in-app centre; §5 schema).
2. Resolves the recipient's **email preference** for the event's category (config default when unset), and —
   if enabled and not coalesced — enqueues the content-light email through the **existing** path
   `enqueueTransactionalEmail(templateId, { …, preference: { organizationId, recipientProfileId } })`
   (`services/jobs/email-jobs.ts:71-123` → BullMQ `apps/jobs`). The `preference` object makes
   `EmailPreferenceLookupCache.shouldSend` gate it (`email-jobs.ts:89-103`).
3. **Failure isolation (carried from Phase 3):** the whole emit is **fire-and-forget** from the parent write —
   wrapped in try/catch that only logs; a notification/email failure must **never** roll back the
   submission/result/message/announcement (`coursework.ts:130-136`, `marking.ts:121-131`; pinned by
   `coursework-notify-nonfatal.test.ts`). The in-app insert and the email enqueue are independently
   best-effort.

**Migrating the two Phase-3 sends (behaviour preserved):** `notifyCourseworkSubmitted` /
`notifyCourseworkResulted` (`services/coursework/notifications.ts`) become emitters of `submission.created` /
`result.recorded`. They keep their content-light templates (`coursework-submitted.ts`,
`coursework-resulted.ts`) and their fire-and-forget call sites — the change is (a) they now also write an
in-app notification, and (b) they pass `preference` so the coursework category becomes user-toggleable (today
they do NOT pass it, so those emails bypass preferences — `notifications.ts:48-56,80-88`). The
`COURSEWORK_EMAILS_ENABLED` global toggle stays as a kill-switch beside the per-user preference.

## 3. Reuse-vs-new verdict (stock machinery)

| Feature | Verdict | Why |
|---|---|---|
| **Newsfeed** (`course_newsfeed`, `routes/course/newsfeed.ts`) → **announcements** | **Reuse the PATTERN, new slim table** | Its write-side is already what announcements want — staff-only `POST` (`courseTeamMemberMiddleware`), **server-derived author** (no spoofing), HTML-sanitised, **email fan-out to members already wired** (`newsfeed.ts:112`). But it hard-couples **reactions (jsonb) + two-level threaded comments** and carries an **un-closed §4-B child-id IDOR** (`ACCESS.md:343`). So: build a **slim `announcement` table** (no reactions, no comments) and borrow the staff-POST + email-fanout pattern; do NOT inherit the comment/reaction baggage or the deferred IDOR. |
| **Community** (`community_question`/`community_answer`, votes+answers) | **Avoid** | It is a **Q&A forum** — exactly the shape the scope fence excludes. Its old permission gaps are already CLOSED in this fork, so it's not dangerous — just the wrong product. |
| **Messaging / DMs** | **New** | No private-thread primitive exists anywhere. `lesson_comment`, newsfeed comments, community answers are all **public-broadcast, `groupmember`-authored, no participant/recipient/read-state/privacy**. `aiChatConversation` is learner↔LLM. Build the tutor↔learner thread fresh. |
| **In-app notification centre / bell** | **New** (reuse email-prefs) | **No `notification` table, no bell feature** — email-only today; the "notifications" screen is just email toggles and `BellIcon` is decorative. Build the in-app table + centre new; **reuse** `@cio/db/queries/notifications` (`shouldSendEmail`/`EmailPreferenceLookupCache`) as the "also email?" gate. |
| **Preferences** (`organizationmember_email_notifications` + `email-toggles.ts` + `notifications.svelte`) | **Reuse + extend** | A per-user, per-category, self-only email-toggle system **already exists and is mounted on BOTH surfaces** (`routes/(app)/lms/settings/notifications`, `…/org/[slug]/settings/notifications`). Phase 6 **extends** it with the new categories (message, announcement, session, coursework) rather than adding a parallel `notification_preference` table — new toggle keys in `email-toggles.ts` + `EMAIL_TOGGLE_MAP` + the columns they need, and they render automatically in the existing panel. |
| — **AS-BUILT (Phase 6 Steps 2 + 6)** | **Superseded** | The Step-2/Step-6 prompt packs (authoritative) directed a **dedicated `notification_preference` table** keyed by the framework's own `NOTIFICATION_CATEGORIES` (coursework/messaging/announcement/session), resolved by the **single** `getCategoryEmailEnabled(userId, category) = row ?? config default` in `services/comms/notify.ts` — the same function the send path uses (no second resolver). The settings surface is a dedicated **`comms-preferences.svelte`** section rendered inside the existing `notifications.svelte` page, so it appears on BOTH surfaces unchanged; it auto-saves per toggle and carries an "in-app notifications always arrive" note. The pre-implementation "reuse email-toggles.ts / no new table" verdict above is retained for history but does **not** describe the shipped system. |
| **Realtime transport** | **None — stay poll/refresh** | No WebSocket/SSE/Supabase-realtime in the app (`CODEMAP.md:230`); the only SSE is AI-token streaming. The centre refreshes on load + on navigation + after actions; the brief forbids new realtime infra. |

## 4. Schema (Step 2 migration `0014`, repo-exact style)

New tables (Phase-3/4/5 conventions: `pgTable`, `uuid().defaultRandom().primaryKey()`, named
`foreignKey(...).onDelete(...)`, `unique(...)`, `index(...)`, `timestamp(withTimezone, mode:'string')`;
authorship FKs are nullable `set null`; short enum-ish values are `varchar` with the set in config, never a pg
enum). **AS-BUILT:** a dedicated **`notification_preference`** table (Step-2 migration `0014`) backs comms
preferences, resolved by the single `getCategoryEmailEnabled` (§3 as-built note) — not the older email-toggle
machinery.

- **`message_thread`** — one per **pair**: `id`, `organization_id→organization` (cascade), `tutor_id→profile`
  (cascade), `learner_id→profile` (cascade), `archived_at` (null = active; set = read-only after
  reallocation), `created_at`. **`unique('message_thread_pair_unique').on(tutor_id, learner_id)`** (mirrors
  `tutor_allocation_pair_unique`; a different tutor is a different pair → different row; same pair reactivates
  by clearing `archived_at`). Indexes on `tutor_id`, `learner_id`.
- **`message`** — `id`, `thread_id→message_thread` (cascade), `sender_id→profile` (cascade), `body text`
  (**text only — NO attachment column, ever**), `created_at`. Index `(thread_id, created_at)` for timeline.
  Rows are **append-only** (no edit/delete).
- **`message_read`** — per-participant read **cursor** (cheaper than per-message rows for a 2-party thread):
  `id`, `thread_id→message_thread` (cascade), `profile_id→profile` (cascade), `last_read_at`.
  `unique(thread_id, profile_id)`. Unread = `message.created_at > last_read_at AND sender_id != me`.
- **`announcement`** — `id`, `organization_id→organization` (cascade), `author_id→profile` (**nullable set
  null** — survives author deletion), `course_id→course` (**nullable = provider-wide**, cascade), `title
  varchar`, `body text`, `published_at`, `created_at`. Indexes on `organization_id`, `course_id`,
  `published_at`.
- **`notification`** — `id`, `user_id→profile` (cascade, the recipient), `type varchar`
  (`NOTIFICATION_TYPES` config), **polymorphic** `entity_type varchar` + `entity_id uuid` (FK-less — a per-
  source FK column would force a migration per new type; notifications are ephemeral and the reader
  resolves/skips dangling refs), `created_at`, `read_at` (null = unread). Indexes on `user_id` and
  `(user_id, read_at)` (unread-count/inbox).

**Config** — new `packages/utils/src/constants/notification.ts` (registered in `constants/index.ts`,
mirroring `result.ts`/`unit-type.ts`): `NOTIFICATION_TYPES` (the five, `as const` + guard),
`NOTIFICATION_CATEGORIES = ['coursework','messaging','announcement','session']`,
`NOTIFICATION_EMAIL_DEFAULTS = { coursework:true, messaging:true, announcement:false, session:false }`
(D3), `NOTIFICATION_COALESCE_WINDOW_MS`. Type→category map lives here too. The DB `type`/`entity_type`
columns stay plain varchars so the set extends in config with no migration.

## 5. Entry points (where each surface mounts — grounded)

- **Notification bell + unread badge + dropdown** — replace the existing static "No Notifications" placeholders
  in **both** headers with one shared `NotificationBell`: `ui/navigation/app-header.svelte:44-67` (org/admin
  shell) + `ui/navigation/lms-header.svelte:36-59` (learner shell). One component serves every role; no new
  shell wiring.
- **"Message your tutor" (learner)** — in `course/components/lesson/coursework-submission.svelte:78-82` (the
  section header), or the `$isCourseLearnerView` block in `course/pages/lesson.svelte:514-515` beside
  `CourseworkSubmission`. Allocation isn't surfaced to learners today → add a small learner-facing "your tutor"
  read model reusing `listTutorsForLearner`; **empty state** when no allocated tutor ("You'll be able to
  message your tutor once one is assigned").
- **"Message learner" (tutor)** — `caseload/pages/learner-detail.svelte:47-50` (header action next to the
  name, always allocation-verified) + optional row action in `caseload/pages/caseload.svelte:93-100`.
- **Announcements — read** (learner): `lms/pages/dashboard.svelte` (a banner/section, ~:199-200 or the grid at
  :314). **Compose** (staff): new route `routes/(app)/org/[slug]/announcements/` (peer of `community`,
  `allocation`) + nav in `ui/navigation/org-navigation.ts` (people group).
- **Notification preferences** — at `routes/(app)/lms/settings/notifications/+page.svelte` and
  `…/org/[slug]/settings/notifications/+page.svelte` (shared `settings/pages/notifications.svelte`). **AS-BUILT
  (Step 6):** a dedicated `features/notifications/components/comms-preferences.svelte` section is rendered inside
  that shared page (so it lives on BOTH surfaces), backed by `features/notifications/api/preferences.svelte.ts`
  → `GET/PUT /notifications/preferences[/:category]`. Effective values come from the single
  `getCategoryEmailEnabled` resolver; it auto-saves per toggle and notes that in-app notifications always arrive.

## 6. Audit

- **`announcement.published`** → audited (ids only: `{announcementId, courseId|null, authorId}`) — a
  provider-facing broadcast is an accountable action.
- **Messages → NEVER audited.** Message threads are **private correspondence**; even ids-only audit rows would
  record who-messaged-whom-when, which is content metadata we deliberately do not log. (In-app notifications
  and read-state are the operational record; there is no audit trail of private messaging.)
- Notifications + preference changes: not audited (self-only operational state, no PII value).

## 7. ACCESS.md rows (Step 4–6, added to §10 when live)

| Surface | Endpoint | Guard | Target access |
|---|---|---|---|
| Thread list | `GET /messages/threads` | `requireActor` + self-scope (`tutor_id` OR `learner_id` = `actor.userId`) | Own threads only; Admin oversight (D2) |
| Thread + messages | `GET /messages/threads/:threadId` | `requireActor` + `isThreadParticipant` OR Admin (D2) | The two participants; Admin read-only; Manager **NO** |
| Send message | `POST /messages/threads/:threadId` | `requireActor` + participant + **live `isAllocatedTutor`** + not archived | Participant of an ACTIVE pair only |
| Open thread | `POST /messages/threads` (upsert on pair) | `requireStaff`/Admin, allocated pair (`isTutorAllocatedToLearner`) | Allocated tutor / Admin |
| Mark thread read | `POST /messages/threads/:threadId/read` | `requireActor` + participant | Participant self |
| Compose announcement | `POST /announcements` | provider-wide → `requireManagerOrAdmin` (D1); course → `requireStaff` | Admin/Manager (wide), course staff (scoped) |
| Read announcements | `GET /announcements` | `requireActor` + scope filter (provider-wide to all; else `isEnrolledLearner`) | Enrolment-scoped + provider-wide; staff see all |
| Notification centre | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` | `requireActor` + `user_id = actor.userId` | **Self only** — no `userId` param exists |
| Preferences | `GET /notifications/preferences`, `PUT /notifications/preferences/:category` (self, `requireActor`) | self-only — actor from session, only the category is a path value | Self only |

## 8. No-attachments invariant (product integrity)

**Messages are text-only. There is no attachment column on `message`, no file field on any messaging
endpoint, and no upload affordance in any messaging UI — anywhere, ever.** Coursework files travel **only**
through the Phase-3 submission flow (versioned `coursework_submission` under the `coursework/…` key scheme,
gated by `requireCourseworkSubmit`). This is an invariant, not a default: a learner must not be able to route
coursework past marking/versioning/gating by pasting a link or attaching a file in a message. (Links inside a
message body are plain text; they are not rendered as uploads and grant no storage access.) The Step-7
adversarial pass asserts there is no file path through the comms channel.

## 9. Test matrix (isolation tests written with/before each endpoint, Steps 4–6)

- **Messaging privacy (adversarial):** a non-participant learner/tutor → thread read + send **403**; the other
  learner's thread by id-tampering → **403**; a de-allocated tutor → send **403** (archived/read-only), read
  still allowed if D2; Admin read-any per D2; Manager **403**; anon **401**. Zero forbidden successes.
- **Announcement scoping:** an unenrolled learner does **not** see a course-scoped announcement; everyone sees
  provider-wide; staff see all; compose denied for non-permitted roles; `announcement.published` audited.
- **Notification centre self-only:** a learner sees only their own notifications; no `userId` param; mark-read
  only affects own rows.
- **Preferences honoured:** email off for a category → **no email but the in-app notification still arrives**;
  self-only; defaults from config when unset; the two migrated coursework emails now respect the toggle.
- **No-attachments:** every messaging endpoint rejects/has-no file field; coursework cannot enter via comms.
- **Framework failure isolation:** a notification/email failure never rolls back the parent write (carry the
  Phase-3 non-fatal test to every new emitter).
- **Baseline:** full suite at/above baseline; only the documented F1 file-load failures.

## 10. Build order (Steps 2–7, for context)

2. **Framework core + config + migration `0014`:** `notification.ts` config; the `notification` table + query
   + `emitNotification` helper (in-app always + email-per-preference gate); extend `email-toggles.ts` with the
   new categories; **migrate the two Phase-3 sends** onto it (behaviour preserved, now preference-gated).
   Test-first on the emitter + preference gate + failure isolation.
3. **Notification centre UI:** the shared `NotificationBell` (badge/list/mark-read/read-all, each item links to
   its subject) in both headers; self-only endpoints. Isolation test.
4. **Messaging:** the three tables; thread upsert on allocated pair; text-only send with live `isAllocatedTutor`
   + not-archived; read cursor; `message.received` emit with per-thread coalescing; reallocation archives the
   old thread (hook `removeTutorAllocation`); learner "message tutor" + tutor "message learner" entry points +
   empty state. Adversarial isolation tests **with** each endpoint (plan-mode if threading tangles).
5. **Announcements:** the slim table; compose (D1 scoping) + read (enrolment scope); `announcement.published`
   emit + audit; learner surface + staff compose route. Scoping tests.
6. **Preferences wiring:** confirm the new categories render + are honoured on both settings surfaces; config
   defaults; self-only. Preference tests.
7. **Reviewer + adversarial subagents** + whole-comms E2E + `docs/PHASE6.md`.

## 11. Verification (this step)

Spot-checks against code (done during the sweep): stock newsfeed staff-POST + email-fanout
(`routes/course/newsfeed.ts:58,112`); no `notification` table / decorative bell (`app-header.svelte:44-67`);
no realtime (`CODEMAP.md:230`); Phase-3 sends bypass preferences today (`notifications.ts:48-56,80-88` pass no
`preference`); existing per-user pref UI on both surfaces (`settings/pages/notifications.svelte`,
`email-toggles.ts`). Owner confirms **D1–D4** before Step 2.
