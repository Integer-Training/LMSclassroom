# ACCESS.md — access-control inventory & target matrix (Phase 1 spec)

The spec that Phase 1 Steps 2–8 implement and test against. Part 1 is the **target**
(role model + ownership). Part 2 is the **current reality** (how authz works today).
Part 3 is the **inventory** (every dashboard route + API endpoint, its current guard,
its target access). Part 4 is **known gaps**. Part 5 is the **decision log** + Phase-1
delta. Compiled 2026-08-12 from a 3-agent code sweep of the actual repo; every "current
guard" is code-traced (spot-checks in §6).

Scope fence: this is inventory + target only. No allocation table/caseload (Phase 3),
registration approval (Phase 7), reports (Phase 5), authoring (Phase 2), assessment (never).

---

## 1. Target role model (verbatim)

| Role | Home | Can | Cannot |
|---|---|---|---|
| **Learner** | Own courses & progress | Access own course content, upload coursework, read own results + feedback, message tutor | See anyone else's work; any marking/admin/staff screen |
| **Tutor** | Caseload (Phase 3) | See allocated learners' uploads; record result + feedback | Open a non-allocated learner; author courses; approve registrations; user management |
| **Manager** | Provider-wide (Phase 5) | Reports, allocate tutors↔learners, approve registrations, see completions (features arrive in later phases) | System config, integrations, user management |
| **Admin** | Everything | All the above + author courses, manage users, config, integrations | — |

### Ownership rules

- **Learner → self only.**
- **Tutor → allocated learners.** The allocation table arrives in Phase 3; **the predicate
  must exist now and deny until then** (a tutor can reach no learner's individual data in
  Phase 1 beyond what allocation will later grant).
- **Manager → provider-wide read** for its features as they arrive; **never** config or user
  management.
- **Admin → all.**
- **Anonymous → login only.**
- **Deny-by-default everywhere authenticated.** Knowing a URL or an object id must never, by
  itself, grant access.

### Role mapping (current → target)

| Target | Current ClassroomIO | id |
|---|---|---|
| Admin | ADMIN | 1 |
| Tutor | TUTOR | 2 |
| Learner | STUDENT | 3 |
| **Manager** | **does not exist** | **(new, Phase 1 schema)** |

---

## 1.2 Registration model — CLOSED / provision-only (Step 6)

**PearlLMS is a closed system: there is no public self-registration or org self-onboarding
anywhere.** An account comes into existence ONLY through staff provisioning (Step 7 — Better Auth
`admin.createUser` and/or a staff-created roster row linked on first sign-in). Provisioned users
sign in, sign out, and reset their passwords normally. Verified live (unauthenticated sign-up →
`EMAIL_AND_PASSWORD_SIGN_UP_IS_NOT_ENABLED`; anonymous → 404; social → `SOCIAL_AUTH_NOT_ENABLED`;
learner sign-in → 200; password-reset request → 200; org create → 403; DB unchanged).

**DISABLED (was a public creation path):**
- `POST /api/auth/sign-up/email` — Better Auth `emailAndPassword.disableSignUp: true`
  (`packages/db/src/auth/email-password.ts`).
- Google OAuth auto-create — `socialProviders.google` removed (`packages/db/src/auth.ts`);
  `/api/auth/sign-in/social` → not enabled. Google button removed from `auth-ui.svelte`.
- `POST /api/auth/sign-in/anonymous` — `anonymous()` plugin removed (`auth.ts`) → 404.
- Org self-onboarding — `POST /onboarding/create-org` and `POST /organization` both funnel through
  `createOrganizationWithOwner`, which throws 403 on self-hosted once the singleton org exists.
  Dashboard `(auth)/onboarding` redirects to home for anyone who already has an org.
- Net-new membership self-join — `POST /organization/auto-join` refuses on self-hosted for a
  non-member (`services/organization/auto-join.ts`); the staff-provisioning link path (an
  email-only roster row linked on first sign-in) is preserved, and existing members get a no-op.
- Sign-up UI — `/signup` redirects (308) to `/login`; "Sign up" links removed from `auth-ui.svelte`,
  `Navigation/AuthButtons.svelte`, the org-site enroll page, and the two invite pages (invitees are
  provisioned → they log in).

**KEPT (provisioned users):** `sign-in/email`, `sign-out`, `request-password-reset` /
`reset-password`, `verify-email`, `change-email`, `login-link` (session for an existing user), and
Better Auth `admin.createUser` (the Step-7 provisioning door — unaffected by `disableSignUp`).

**Inert vectors (documented, not removed):** the `sso()` and `tokenExchange()` plugins remain
(the `/organization/sso` + `/organization/token-auth` routes import them) but cannot create
accounts — no provider or token-auth secret is configured (`organization_sso_config`,
`sso_provider`, `organization_token_auth` all empty). If those enterprise integrations are ever
enabled, their JIT account creation must be reviewed. The reusable `link-invite` self-accept
(`invite.ts`) still lets any authenticated user with the link self-join at its role — left for the
Phase-7 approval queue (ACCESS.md §4); it cannot create an account, only a membership for an
already-provisioned user.

---

## 2. Current authz model (how it works today)

**Session → user.**
- **API** (`apps/api/src/app.ts:67-104`): global middleware calls `auth.api.getSession()` and
  sets `c.get('user')`, `c.get('session')`, and `c.get('orgRoles')` = `{ [orgId]: roleId }`.
  `orgRoles` comes from Better Auth `customSession` (`packages/db/src/auth.ts:140-150`) →
  `getUserOrgRolesMap` (`packages/db/src/queries/organization/organization.ts:509-529`).
  **It is cookie-cached (1h `cookieCache`, 30-day session) — authorization reads the cached
  map, not a per-request DB row.** A role change therefore lags up to 1h unless the client
  forces `disableCookieCache` (the dashboard does this on membership change, `init.svelte.ts:242,485`).
- **Dashboard** (`apps/dashboard/src/hooks.server.ts:47-51`): `getSessionData(cookies)` → `locals`;
  the gate only checks `locals.user` truthiness.

**Where roles live (8 places; only 2 authoritative):**
1. `role` table (`schema.ts:1999`) — rows 1/2/3.
2. **`organizationmember.roleId`** (`schema.ts:1816`) — **authoritative org role**. No status column.
3. **`groupmember.roleId`** (`schema.ts:1258`) — **authoritative course/cohort role**.
4. `courseInvite.roleId` / 5. `organizationInvite` role / 6. `ROLE` constant (`roles.ts`).
7. Better Auth `user.role`/`banned`/`banReason`/`banExpires` (`schema.ts:88`) — **unused for authz**.
8. `profile.role` (varchar) + `profile.isRestricted` (`schema.ts:403,412`) — **loaded, never read**.

**No single resolver.** "Is caller org admin?" is implemented **4 different ways**
(`org-admin.ts` session-map, `org-admin-or-automation-key.ts` session-map,
`org-admin-or-api-key.ts` DB, `organization.ts` DB helper). "ADMIN-or-TUTOR" is spelled inline in
≥5 files. Course/cohort scope has **no shared resolver** — "find my member row by profileId, read
roleId" is duplicated in ~9 dashboard files. This is the ad-hoc sprawl Step 2 must collapse into
one server-side helper.

**No status / deactivation.** `organizationmember` has only `verified` (invite email, not access).
`profile.isRestricted` and `user.banned` exist but are **never checked** anywhere. **A deactivated
or banned user with a live session keeps passing every guard** (up to 30 days). Only org-wide switch
is `organization.readOnlyUntil` (`workspace-not-readonly.ts`, blocks mutations org-wide). Phase 1
must add per-user status + a live-session block.

**PII.** `profile` (`schema.ts:392`): `fullname, username, email, avatarUrl, telegramChatId, goal,
source, metadata, settings` (+ verification/locale/isRestricted). Today full profile rows (name +
email + avatar) reach **any TUTOR** via `getOrganizationAudience`/`getOrganizationTeam`
(`organization.ts:656,558`) and course/cohort people endpoints — **no field-level PII restriction**.
Phase 1 makes the PII table admin-only.

---

## 3. Route & endpoint inventory

Guard legend — **HOOKS**: dashboard session-existence gate only; **API**: authz delegated to the
backend (dashboard forwards the cookie + `cio-org-id` header from the URL slug); **CLIENT/none**:
no server guard, shell renders for any authed user; **PUBLIC**: intentionally anonymous;
**APIKEY**: server-to-server via `PRIVATE_SERVER_KEY`.

### 3a. Dashboard routes (`apps/dashboard/src/routes`)

> **Structural fact:** the dashboard performs **zero** role/ownership checks. `hooks.server.ts`
> gates on session existence only; everything else is delegated to the API. There are **no** form
> actions. Target for all authenticated rows below: a **server-side** role+ownership guard
> (Step 3), deny-by-default. Every route appears once.

| Route (group) | Purpose | Current guard | Target access | Gap? | Phase |
|---|---|---|---|---|---|
| _all routes_ (`hooks.server.ts`) | auth gate | HOOKS (session exists only) | — | unanchored public regexes; passes on stale cio cookie | 1 |
| `(auth)/login,signup,logout,forgot,reset,auth-failed,verify-email-error` | auth flows | PUBLIC | Anonymous | — | 0 |
| `(auth)/onboarding` | first-run org setup | HOOKS | Authed (any) | — | 0 |
| `/`, `/404`, `/csp-report`, `/invite/[hash]`, `/invite/link/[hash]` | home / public / invite preview | PUBLIC/APIKEY | Anonymous | — | 0 |
| `/api/polar/*` (buy-tokens, subscribe, portal, webhook) | billing | API + self-membership check (webhook: signature) | Admin (billing) | plan endpoints loose (see §4-I) | 5 |
| **`(app)/org/[slug]`** + `/dash /courses /cohorts /audience /audience/* /community* /api /mcp /media /tags /widgets /setup` | **org admin surface** (server loads → API) | API only; orgId trusted from slug | **Admin** (Manager read for reports later) | orgId not verified at SK layer; silent-empty on 403 | 1 (features 2/5) |
| `(app)/org/[slug]/settings/*` (org, teams, auth, auth/sso, token-auth, billing, domains, integrations, customize-lms, landingpage, notifications, workspaces, ai-credits, ai-tutor) | **config / user mgmt / integrations** | **CLIENT/none** (no server load) | **Admin only** | **URL renders shell for any authed user** | 1 |
| `(app)/org/[slug]/analytics, compliance, teams-overview, zapier, quiz, quiz/[slug]` | org admin views | CLIENT/none | Admin (Manager read later) | no server guard | 1 (features 5) |
| **`(app)/courses/[id]`** + `/analytics /marks /submissions /exercises/[exerciseId] /lessons/[lessonId] /people/[personId]` | **course admin/authoring + marking** | API only; courseId trusted | **Admin** (author); **Tutor** (marking, allocated only) | orgId/courseId unverified at SK; **marking has no allocation** | 1 (authoring 2) |
| `(app)/courses/[id]/settings, people, attendance, certificates, certificates/editor, compliance, landingpage, lessons, ai-tutor` | course admin | CLIENT/none | Admin (author) | no server guard | 1 (features 2) |
| **`(app)/cohorts/[id]`** + `/courses /newsfeed /people /settings` | cohort | CLIENT/none | Admin / Tutor(team) | no server guard | 1 (features 3/5) |
| **`(app)/lms`** + `/certificates /cohorts /community* /exercises /explore /mylearning /settings*` | **learner surface** | HOOKS + CLIENT | **Learner (self only)** | no server ownership guard | 1 |
| `(app)/home, widgets/[widgetId], widget-preview` | misc | HOOKS + CLIENT | Authed | — | 1 |
| `(org-site)/courses, course/[slug], course/[slug]/enroll, /lesson, /lesson/[itemSlug]` | **public org site** | PUBLIC/APIKEY | Anonymous | — | 0 |

### 3b. API endpoints (`apps/api/src/routes`)

> Grouped by router; every endpoint is represented. Middleware legend: **auth**=session;
> **orgMember/orgTeamMember/orgAdmin**=role vs the `cio-org-id` **header**; **courseMember/
> courseTeamMember**=role vs the path `:courseId`; **cohortMember/cohortTeamMember**=cohort role;
> **apiKey/automationKey**=machine. **Target** column states the PearlLMS role + ownership rule.

| Router / endpoints | Current guard | Target access | Gap? | Phase |
|---|---|---|---|---|
| `POST /api/auth/*` (Better Auth), sign-up→`signupGuard`; `GET /session` | Better Auth / inline | Anonymous→self | — | 0 |
| **/account** `GET /account`,`GET/PUT /account/profile`,`POST /view-as-student-token` | auth | Learner+ (self) | — | 1 |
| /account `/workspaces` (GET/POST/DELETE), `/usage` | auth+orgAdmin | **Admin** | — | 1 |
| **/course** `POST /course` (create) | auth+orgAdmin | **Admin** (author) | — | 2 |
| /course `GET /:courseId`, `/progress`, `/certification-evaluation`, `/download/*` | auth+courseMember | Learner(self)/Tutor(allocated)/Admin | ownership not enforced | 1 |
| /course `PUT/DELETE /:courseId`, `/analytics`, content/section reorder | auth+courseTeamMember | **Admin** (author) | cross-course IDOR on child ids (§4-B) | 2 |
| /course **`/mark`, `/mark/gradebook`** | auth+**courseMember** | **Tutor(allocated)/Admin** | **allows STUDENT to pull whole class** (§4) | 1 |
| /course **`/submission/for-grading` (GET), `/:submissionId` (PUT/DELETE), `/answer`, `/grades`** | auth+**courseTeamMember(:courseId)** | **Tutor(allocated)/Admin, own submission's course** | **cross-course IDOR — service ignores courseId** (§4-A) | 1 |
| /course `/exercise/*` (read/write/submission/video) | auth/authOrAutomationKey + courseMember/courseTeamMember | Learner(self)/Admin(author) | child-id IDOR (§4-B) | 2 |
| /course `/lesson/*`, `/lesson-language/*`, `/section/*`, `/newsfeed/*`, `/content/*` | auth+courseMember/courseTeamMember; comments→author guards | Learner(read)/Admin(author) | **lesson comment edit/delete has no author check**; child-id IDOR (§4-B) | 2 |
| /course **`/people` (GET/POST/PUT/DELETE), `/:memberId/reset-progress`, `/:userId/analytics`** | auth+**courseTeamMember** | **Admin** (roster/roles) | **TUTOR can add/promote to course-ADMIN incl self; roleId unconstrained** (§4) | 1 |
| /course `/attendance` (POST) | auth+courseMember | Tutor/Admin | student can upsert arbitrary body (§4-J) | 1 |
| /course `/compliance/*` | auth+courseTeamMember; `/learners/:profileId`→courseMember | Tutor(allocated)/Admin | `/learners/:profileId` any student (verify svc) | 1 |
| /course `/invite/*`, `/ai-tutor` | auth+courseTeamMember | Admin | — | 2 |
| /course **`/presign/{video,document}/{upload,download}`** | **auth only** | Learner(self)/Tutor(allocated)/Admin, scoped key | **any authed user mints URL for any key** (§4-H) | 1 |
| /course `GET /slug/:slug`, `/katex`, `payment-request` | PUBLIC | Anonymous | katex throws w/o query (§4-J) | 0 |
| **/cohort** `GET /` (list), `POST /` (create) | **auth only** (org from query/body) | Admin/Manager | **any authed user lists/creates in any org** (§4-D) | 1 |
| /cohort `/:cohortId` (GET/PUT/DELETE), members, courses, newsfeed, goals | auth+cohortMember/cohortTeamMember | Learner(self)/Tutor(team)/Admin | cross-cohort IDOR on feedId (§4-C) | 3/5 |
| /cohort `/enrolled`, `/my/goals` | auth (self) | Learner (self) | — | 1 |
| /cohort `/goals/overview` | auth+orgTeamMember (?organizationId) | Tutor/Admin/Manager | header-vs-query org (§4-F) | 5 |
| **/community** `GET /?orgId`, `/:slug`, `POST /`, comments, upvote | auth+orgMember (org from query/body) | Learner+ (own org) | **cross-org read via ?orgId; body author/org spoofing** (§4-F,G) | 1 |
| /community `PUT/DELETE /:id`, `DELETE /:id/comment` | author-or-team guards | author/Tutor/Admin | — | 1 |
| **/organization** `GET /`, `/first`, `/courses`, `/setup` | authOrApiKey / public | member / anonymous | `/setup` public | 1 |
| /organization `POST /auto-join` | auth (header org) | Learner (self join) | auto-join bypass (§4) | 7 |
| /organization `GET /team`, `/audience`, `/audience/:userId/analytics`, resend/revoke-invite | auth+**orgTeamMember** | **Admin** (user mgmt); Manager read (later) | **PII (name/email) visible to TUTOR** | 1 |
| /organization `POST /team/invite`, link-invite, `DELETE /team/:memberId`, `DELETE /audience/:memberId`, `PUT /` | auth+orgAdmin | **Admin** | — | 1 |
| /organization **`POST /audience/import`, `/assign-courses`** | auth+**orgTeamMember** (comment says admin) | **Admin** | **TUTOR can create members + mass-enrol** (§4) | 1 |
| /organization `GET /:orgId/exercises/lms` | auth + manual `getUserOrgRole(:orgId)` | member | — (done right) | 1 |
| /organization `POST/PUT /plan`, `/plan/cancel` | **authOrApiKey** (body subscriptionId) | **Admin** | **any authed user mutates billing** (§4-I) | 5 |
| /organization `/assets/*` (read + write/HLS/attach/detach) | auth+orgMember; export/transcript/delete→orgAdmin | Admin(author)/Manager | **write open to any org member incl students** (§4-J) | 2 |
| /organization `/automation/*`, `/course-import/*` | auth+orgAdmin / automationKey | **Admin** | — | 1 |
| /organization `/search`, `/widgets/*`, `/ai-tutor`, `/quiz/*`, `/member/email-notifications` | auth+orgTeamMember/orgMember/orgAdmin | Admin/Tutor/self | **quiz cross-org IDOR** (§4-E) | 1/2 |
| /organization/**sso**, /organization/**token-auth** | requireLicense + auth+orgAdmin | **Admin** (config) | — | 1 |
| /sso `/discover`, `/org/:orgId` | PUBLIC | Anonymous | — | 0 |
| **/dash** `/stats`, `/landing-stats`, `/country-breakdown`, `/course-funnel`, `/popular-types` | auth+orgMember (**?orgId**) | Manager/Admin read | **cross-org read via ?orgId** (§4-F) | 5 |
| /dash `/login-activity`, `/compliance-overview` | auth+orgAdmin (?orgId) | Admin/Manager | cross-org via ?orgId (§4-F) | 5 |
| /dash `/login-streak` | auth (self) | Learner (self) | — | 1 |
| /dash `POST /track` | PUBLIC | Anonymous | — | 0 |
| **/invite** pending/accept/preview/link | auth / apiKey (token-scoped) | token holder | link-invite anyone-with-URL (§4) | 7 |
| /domain `POST /` | auth+orgAdmin (header) | Admin | — | 1 |
| /hls, /transcripts `GET /:assetId/*` | **no auth**; inline HMAC cookie OR `orgRoles[asset.org]` | Learner(self)/member | dual-path check | 2 |
| /media `POST /image` | **auth only** | Learner+ (self) | any authed user uploads | 1 |
| /mail `POST /` | apiKey | machine | — | 0 |
| /jobs/* | auth+orgMember | member (own org) | — | 1 |
| /license `GET /features` | authOrApiKey | member | — (phone-home removed) | 0 |
| /unsplash `POST /` | PUBLIC | Anonymous | DoS surface (§4-J) | 0 |
| /widgets `GET /:publicKey/payload` | PUBLIC (rate) | Anonymous | — | 0 |
| /internal/* (cron: account/analytics/compliance) | apiKey | machine | — | 0 |
| /org-site/course, /org-site/og | PUBLIC | Anonymous | — | 0 |
| **/agent** status/upload/usage/chat/generate/summarize | auth+orgMember (+ inline team/conversation-owner checks) | Learner+ (self) / Admin | mostly ok; verify inline checks | 2 |
| /agent `/tutor-usage/:userId`, `/credits` | auth+orgAdmin | Admin | — | 1 |
| /agent `/credits/purchase` | **authOrApiKey** (body) | Admin/machine | any authed user records purchase (§4-I) | 5 |
| /public-api/v1/* (courses, audience) | automationKey + scopes | machine (org-scoped) | — | 0 |
| /admin/queues | dev open; prod HTTP Basic | Admin/ops | — | 0 |

---

## 4. Known gaps — where a URL or an id grants access it shouldn't

Every item below is code-traced. These are the ClassroomIO permission gaps Phase 1 must close
(not reproduce). File:line references from the sweep.

**Marking / submissions (the flagged area).**
- **A — cross-course IDOR on grading [CONFIRMED].** `PUT/DELETE /course/:courseId/submission/:submissionId`
  and `/answer`, `/grades` (`routes/course/submission.ts:31,49,59,77`) guard with
  `courseTeamMemberMiddleware` against the **path courseId**, but the services
  (`services/submission/submission.ts:756,815,853,914`) load `getSubmissionById(submissionId)` and
  **never compare `submission.courseId` to the path courseId**. A tutor/admin of any Course A can
  read/modify/grade/delete a Course B submission. **No allocation concept at all** — any course
  tutor can grade any learner in that course.
- **Gradebook allows students [CONFIRMED].** `GET /course/:courseId/mark/gradebook` and `/mark`
  (`routes/course/mark.ts:9,18`) use `courseMemberMiddleware` (STUDENT passes); the service returns
  the whole class unscoped (`services/mark/mark.ts:10-15`) — any enrolled learner pulls every
  learner's grades.

**Registration / roster / privilege escalation.**
- **`audience/import` + `assign-courses` mis-gated.** `routes/organization/organization.ts:711,741`
  are commented "admin" but guarded `orgTeamMemberMiddleware` — a TUTOR can create student members
  and mass-enrol.
- **course/people privilege escalation.** `routes/course/people.ts:51,80` (`POST /members`,
  `PUT /:memberId`) are `courseTeamMember`, and `roleId` is unconstrained
  (`validation/course/people.ts:17,25`) → a TUTOR can add or promote anyone (incl. self) to
  course-**ADMIN**.
- **Link-invite / auto-join.** `services/organization/invite.ts:565-608` — anyone with the URL joins
  at the invite's role, no email match, no approval. `services/organization/auto-join.ts:37-63` runs
  before disableSignup/inviteOnly and claims a pre-seeded elevated role. (Approval queue is Phase 7,
  but the loose join is a Phase-1 authz note.)

**Cross-tenant / cross-object IDOR (client-supplied id trusted).**
- **B — course child-object IDOR.** lesson/section/newsfeed/lesson-language/exercise mutations key on
  the child id, not the path courseId (`routes/course/lesson.ts:107,143,199,217`, `section.ts:52,71`,
  `newsfeed.ts:48,76,95,114`, `lesson-language.ts:29-117`, `exercise.ts:227`). **Lesson comment
  edit/delete (`lesson.ts:199,217`) has no author check at all.**
- **C — cohort newsfeed IDOR.** `cohort.ts:423,445,467` guard the path cohort but act on `feedId`.
- **D — cohort list/create unguarded [CONFIRMED].** `GET/POST /cohort` (`cohort.ts:103,117`) are
  `authMiddleware` only; org comes from query/body → any authed user lists/creates in any org.
- **E — quiz cross-org IDOR.** `/organization/:orgId/quiz` (`organization/quiz.ts`) guards on the
  **header** org, services key on `quizId`/path org → read/update/delete any quiz by id.
- **F — cross-org reads via `?orgId`.** `/dash/*` (`stats.ts:42,53,74,85,102,113,124`) and
  `/community?orgId` (`community.ts:35`) take the target org from the query while validating the
  **header** org → admin/member of A pulls B's data by pairing own header with B's `?orgId`.
- **G — community body spoofing.** `community.ts:70,120` accept `authorProfileId`/`organizationId`/
  `courseId`/`votes` from the body under orgMember(header) — post/comment as another profile.
- **H — presign object-key access [CONFIRMED].** `POST /course/presign/{video,document}/{upload,download}`
  (`presign.ts:57,100,143,181`) are **auth only** with client-supplied S3 keys — any authed user
  mints a download URL for, or writes to, any storage key.
- **I — billing without admin/tenant checks.** `POST/PUT /organization/plan`, `/plan/cancel`
  (`organization.ts:562,583,604`) and `POST /agent/credits/purchase` (`agent.ts:301`) are
  authOrApiKey with a body id — any authed user mutates billing.
- **J — role-scope / misc.** attendance upsert body-only (`attendance.ts:9`); asset write/HLS open to
  any org member incl students (`organization/assets.ts`); unauthenticated DoS surfaces
  (`unsplash.ts:16`, `payment-request.ts:18`).

**Dashboard-layer gaps.**
- **No server-side authz anywhere** — all admin `settings/*`, `analytics`, `compliance`,
  `cohorts/*`, and `courses/[id]/{settings,people,attendance,…}` pages have **no server load**; the
  admin shell renders for any authenticated user. Protection depends entirely on the client-side API
  calls the components make. Knowing the URL renders the page.
- **Unanchored public-route regexes** (`isPublicRoute`, `constants/routes.ts`) — `/courses`, `/reset`,
  `/forgot`, `/login`, etc. match as substrings anywhere in the path.
- **orgId trusted from slug**, cached in a non-httpOnly `cio_org_id_<slug>` cookie without verifying
  membership (`org/[slug]/+layout.server.ts`).
- Auth gate passes on mere presence of a cio cookie even when session resolution failed.
- On backend 403, most admin loads **silently return empty data** rather than deny (only `tags` and
  `widgets` redirect).

---

## 4.1 Step 4 — gap closure status (the central guard layer)

Step 4 added a central, deny-by-default guard layer built on the resolved `actor`
(`apps/api/src/middlewares/guards/` + pure predicates in `@cio/utils/auth` `ownership.ts`):
`requireActor / requireRole / requireAdmin / requireStaff / requireManagerOrAdmin /
requireAdminOrApiKey`, and ownership guards `requireSameOrg / requireSelfParam /
requireMarkingAccess / bindSubmissionToCourse`. Predicates: `isSelf`, `isAllocatedTutor`
(**denies until Phase 3** — the allocation seam), `canManageUsers`, `canAccessConfig`,
`isProviderWideReader`, `sameOrg`. Tests: `apps/api/src/__tests__/authz/` (guard-layer matrix +
ownership predicates + real-router wiring, written test-first — the mark wiring test was RED against
the pre-Step-4 guard and GREEN after).

| §4 gap | Status | Closing guard |
|---|---|---|
| **A** submission cross-course IDOR | **CLOSED** | `requireMarkingAccess` + `bindSubmissionToCourse` on every `/course/:courseId/submission/*` (loads the submission, 404 on course mismatch) |
| gradebook allows students | **CLOSED** | `/course/:courseId/mark`,`/mark/gradebook` → `requireMarkingAccess` (STUDENT removed; TUTOR allocation-denied → ADMIN-only in P1) |
| roster `audience/import`+`assign-courses` mis-gated | **CLOSED** | `requireAdmin` (was orgTeamMember) |
| **course/people** privilege escalation | **CLOSED** | all `/course/:courseId/members` ops → `requireAdmin` (a tutor can no longer add/promote to course-ADMIN) |
| **D** cohort list/create unguarded | **CLOSED** | `GET/POST /cohort` → `requireAdmin` (+`requireSameOrg` on the query) |
| **E** quiz cross-org IDOR | **CLOSED (org scope)** | `quizRouter.use(requireSameOrg({param:'orgId'}))` binds the path org to the actor. *Residual:* per-`quizId`→org bind is part of the deferred child-id binding (low risk; quizzes are not PII) |
| **F** cross-org via `?orgId` | **CLOSED** | `/dash/*` → `requireManagerOrAdmin`+`requireSameOrg`; `/community?orgId` → `requireSameOrg` (authz reads `actor.orgId`, not the query) |
| **G** community body spoofing | **CLOSED** | `POST /community` + comment now take author/org from the session (`user.id`, `orgId`), ignore body `authorProfileId`/`organizationId`/`votes` |
| **I** billing without admin | **CLOSED** | `/organization/plan*` + `/agent/credits/purchase` → `requireAdminOrApiKey()` (machine key path kept; any-authed-session path removed) |
| PII admin-only | **CLOSED** | `/organization/team`,`/audience`,`/audience/:userId/analytics`,resend/revoke-invite → `requireAdmin` (was orgTeamMember → PII reached TUTORs) |
| **J** attendance | **CLOSED** | `POST /course/:courseId/attendance` → `requireStaff` (students can no longer upsert) |
| **J** asset writes | **PARTIAL** | asset-authoring mutations (`POST /assets`, `PUT /:assetId`, `/thumbnail`, attach/detach) → `requireAdmin`. *Deferred to the Phase-2 authoring pass:* the HLS transcoding-pipeline endpoints + playback-cookie stay `orgMember` (part of the upload/playback flow; not safely unit-testable here) |
| **H** presign object-key access | **HARDENED, full bind DEFERRED** | presign → `requireActor()` (now deactivation-aware). A full per-key ownership bind is **not** cleanly possible today: keys are flat `nanoid()` capability tokens with no course scope, stored in submission-answer JSON (no indexed column), and the same endpoint serves both private coursework and shared lesson materials. Closing it properly needs course context threaded into the presign contract (a client-contract change) — tracked for a follow-up |
| **B/C** child-object IDOR (lesson/section/newsfeed/lesson-language/exercise/cohort-newsfeed child ids; lesson-comment author) | **DEFERRED (Phase-2 authoring)** | These live on Phase-2 authoring surfaces and are already guarded at the **path** course/cohort scope (team-member). The residual — re-binding a child id to its path parent — uses the pattern established by `bindSubmissionToCourse` and is scheduled with the Phase-2 authoring hardening |
| link-invite / auto-join loose join | **DEFERRED (Phase 7)** | approval queue is Phase 7 (noted in §4); the loose join is a Phase-7 authz item |
| Dashboard-layer gaps (no server authz, unanchored regexes, slug-trust, silent-empty) | **DEFERRED (dashboard pass)** | Step 4 is API enforcement (the true boundary). Dashboard-native server guards are a separate follow-up |

**Net:** every Phase-1-critical authz gap (cross-learner / cross-course / cross-org data exposure,
privilege escalation, PII leakage, billing) is closed by construction. The remaining items are
either lower-risk Phase-2 authoring integrity (child-id binding, asset pipeline), an architecturally
harder capability-URL problem (presign H, hardened), or explicitly later-phase (auto-join P7,
dashboard pass) — each documented above rather than silently dropped.

## 5. Decision log & Phase-1 delta

**Decisions (owner to confirm/adjust):**
- **Tutor-allocation predicate denies until Phase 3.** Phase 1 adds the predicate (the seam where a
  future allocation table is consulted) and hard-codes it to **deny** — a tutor reaches no
  individual learner's data until Phase 3 wires allocation.
- **PII `profile` table is Admin-only in Phase 1.** Tutors/Managers do not read learner name/email
  via profile in Phase 1 (owner may widen later — e.g. tutor sees allocated learners' names in Phase 3).
- **Manager role added to the schema in Phase 1** (role id 4). Its *features* (reports, allocation,
  approvals) arrive in Phases 3/5/7; Phase 1 only establishes the role + "never config/user-mgmt".
- **Deny-by-default in all authenticated areas**, on both API and dashboard.
- **Role + status resolved through one server-side helper** (Step 2); no route derives role/session ad hoc.

**Phase rows:** entries marked Phase 2–7 above are inventoried now but their *feature* work lands in
that later phase; Phase 1 only ensures each is guarded (role+ownership) and deny-by-default.

**What Steps 2–8 must build (delta):**
1. **Schema (Step 2):** add Manager role (id 4); add a per-user/membership **status** (active/
   deactivated) + block live sessions; add the **allocation predicate** seam (deny until Phase 3);
   **audit_event** table.
2. **Single resolver (Step 2):** one server-side helper returning `{role, status}` for a caller in a
   scope; collapse the 4 org-admin variants + ~9 duplicated course/cohort checks.
3. **API guards (Step 3/5):** close every §4 gap — bind object ids to the caller's scope (submission→
   its course; child objects→path parent; quiz/dash/community→resolved org, not header-vs-query);
   fix mis-gated roster/import/grade endpoints; scope presign to owned keys; admin-gate billing.
4. **Dashboard guards (Step 3):** server-side role+ownership guard on every authenticated route;
   deny-by-default; fix unanchored public regexes + slug-trust; deny (not silent-empty) on 403.
5. **Admin user management (Step 6):** create + invite, role change effective next request (bust the
   1h cookie cache), deactivate blocks login + live sessions.
6. **Audit (Step 5-ish):** user created / role changed / status changed / profile edited — no PII
   values in metadata.
7. **Tests (Step 4/8):** per-role allow/deny; learner blocked from staff routes; learner A blocked
   from learner B; anonymous redirected; deactivated-with-live-session blocked; PII admin-only.

---

## 6. Verification (spot-checks performed)

Six inventory rows re-opened against the code (incl. ≥2 gap rows):
1. `submission.ts:31` → `courseTeamMemberMiddleware`; `services/submission/submission.ts:815` loads
   `getSubmissionById(submissionId)` with no courseId compare ✓ (gap A).
2. `cohort.ts:103,117` → `authMiddleware` only, org from `?organizationId`/body ✓ (gap D).
3. `mark.ts:9` → `courseMemberMiddleware` (STUDENT allowed) ✓ (gradebook gap).
4. `presign.ts:181` → `POST /document/download` guarded by `authMiddleware` only ✓ (gap H).
5. `org-admin.ts:14`/`org-team-member.ts:14`/`org-member.ts:12` → role vs `cio-org-id` header ✓.
6. Dashboard `hooks.server.ts` session-only gate + no server load on `org/[slug]/settings/*` ✓.

Completeness: every dashboard route group and every API router under `apps/api/src/routes` is
represented above exactly once.
