# PearlLMS Scalability Plan

**For:** the owner (PearlLMS, ClassroomIO hard fork, repo `C:\Users\PC\Projects\LMSclassroom`)
**Scope:** read-only audit. 10 auditors each had a skeptic check their work. Nothing has been changed.
**Hard rule kept in every item:** tutors only see their allocated learners (docs/ACCESS.md §8, commit `ad92abcf5`). No proposal here caches, widens or replaces the `tutor_allocation` / `isTutorAllocatedToLearner` / `listLearnersForTutor` / `visibleLearnerIdsForCourse` checks.
**Working rules for every phase:** test on localhost first. Every change is a PR, and nothing goes to `main` without your approval. Any step that deletes or rewrites real data (dedupes, purges, cleanups) is listed separately and needs your explicit yes.

---

## 1. Executive summary: top 10 risks

| # | Risk in plain English | When it bites | Phase |
|---|---|---|---|
| 1 | **The allocation screen only lists the newest 100 learners and the newest 100 tutors.** Learner #101 onwards can never be allocated, so no tutor can ever see them. The workflow breaks; this is not a slowdown. | **At 101 active learners or tutors.** Very soon. | E |
| 2 | **Chat freezes after 200 messages.** A tutor–learner thread only ever shows its *oldest* 200 messages. New replies, including the one just sent, never appear. | Each tutor–learner pair, a few weeks into active use. | E |
| 3 | **Every page click repeats the same organization lookups and a social-preview image fetch.** This is the cause of the ~335,000 repeated organization/plan queries and the ~166,000 storage lookups, with only one organization. | Already the largest DB load. Painful at a few hundred users online at once. | C |
| 4 | **Every API call does 3 identity database lookups before any real work**, on a pool of 10 database connections with no timeouts. Background pings (heartbeat, notification bell, study timer) multiply this. When the pool fills, the whole site slows at once. | A few hundred people online at once. | C, D |
| 5 | **Learners get session-reminder emails repeatedly** (up to about 4 "your session is in 24 hours" mails per session) because the "already sent" record expires after 6 hours. | **Already happening.** It gets worse with volume, and duplicate mail damages email sender reputation. | E |
| 6 | **Learner home and marking walk every unit one query at a time** (about 2 queries per unit, per course, repeated 3 times per home load). While a tutor saves a Pass, one database connection is held for that whole walk. | Deadline days and login surges at a few hundred learners. | F |
| 7 | **Course-invite acceptance can deadlock the API.** If about 10 people accept the same invite link at the same moment, every database connection waits for a further connection that never frees up. Only a restart clears it. | The first time an invite link is emailed to a large cohort. | E |
| 8 | **Admin/manager dashboards and download-all load everything into memory.** The admin overview loads every submission in the org twice. "Download all submissions" builds the whole ZIP in RAM. On a 4 GB server shared with everything else, one click can crash the API. | A few thousand learners, or one large download-all. | H, I |
| 9 | **Video playback runs every segment through the full login/rate-limit chain and through the server twice.** Seeking can trigger "too many requests" errors, and after 15 minutes each segment falls back to a slower path. | Grows with hours watched. Noticeable at a few hundred concurrent viewers. | I |
| 10 | **Deploys and operations are fragile.** Images are built on the live server (20–45 minutes of a slow site). There are no memory limits and no log rotation (the disk can fill). Shutdown is not graceful, so in-flight submissions are lost on deploy. Coursework files have no off-site backup. | Every deploy, and any storage incident. | A, J, K |

**Security problems to fix immediately (not scale problems, but urgent):**
- `getApiHeaders` (`apps/dashboard/src/lib/utils/services/api/index.ts:322`) writes every user's **session cookie** into the container logs.
- The email-verification and change-email code writes **live token URLs** to the logs.
- The rate limiter trusts a client-supplied `cf-connecting-ip` header, so anyone can bypass the per-IP limits.

---

## 2. Phases

Phases are ordered by how much risk each removes for the effort. Each phase can be deployed on its own and rolled back on its own. **Infrastructure items with cost changes are in Phase K, kept separate.**

### Phase 0: Measure first (read-only, about 1 hour, needs your go-ahead to run queries)
Run these on the Supabase project `cvtmymxxjgjshrzsjxnj` through the SQL editor or the MCP. All are SELECT-only.
1. Row counts: `session`, `verification`, `groupmember`, `coursework_submission`, `notification`, `message`, `analytics_page_event`, `system_event_log`, `dead_letter_job`.
2. `pg_stat_user_indexes WHERE idx_scan = 0`. This is the authoritative "unused indexes" list.
3. Duplicate pending registrations: `SELECT organization_id, email, count(*) FROM registration WHERE status='pending' GROUP BY 1,2 HAVING count(*)>1`.
4. Supabase region (compare against droplet `lon1`), compute tier, pooler `pool_size`, `max_connections`, and whether PITR (point-in-time restore) is on.
5. On the droplet: `swapon --show`, `df -h`, `docker system df`, plus a week of `docker stats` samples to size the Phase K memory limits.
6. `pg_stat_statements`: record the top 20 by calls and by total time. This is the baseline used to prove each phase helped.

### Phase A: Immediate hygiene (S effort, near-zero risk, deploy first)
**WHY:** this closes credential leaks and the IP-spoofing bypass, and stops the disk filling up. **IMPACT for users:** none.

| Item | File / change |
|---|---|
| hot-path-console-logging | `apps/dashboard/src/lib/utils/services/api/index.ts:322-323`: delete `console.log('headers', headers)`, which contains the session cookie. |
| auth-emails-inline (logs only) | `packages/db/src/auth/email-verification.ts`: delete `console.log('\nsendVerificationEmail', options)` and `console.log('\nsendChangeEmailConfirmation', options)`, which contain token URLs. |
| root-layout-ships-locals (log) | `apps/dashboard/src/routes/+layout.svelte:33`: delete `console.log('Layout', data)`, which dumps the session row in every browser. |
| hot-path-log-spam | Remove these: `apps/api/src/utils/origins.ts:17` ("check origin"); `apps/dashboard/src/lib/utils/services/auth/session.ts:15,44`; `.../auth/server.ts:9-11`; `apps/dashboard/src/routes/+layout.server.ts:57-64`; `(app)/org/[slug]/+layout.server.ts:60-63`; `(app)/org/[slug]/courses/+page.server.ts:51-54`; `layout-setup.ts:61-62`; `hooks.server.ts:156`; `apps/api/src/routes/account/account.ts:30-32` (console.time); `apps/dashboard/src/lib/features/course/api/course.svelte.ts:216`. Keep the hono `logger()` but skip `/health` and `/`. Keep all correlationId and error logs (the RUNBOOK depends on them). |
| unbounded-docker-logs | `docker-compose.deploy.yaml`: add the anchor `x-logging: &logging {driver: json-file, options: {max-size: '20m', max-file: '5'}}` and apply it to redis, api, dashboard, jobs and caddy. |
| spoofable-client-ip | `apps/api/src/utils/redis/key-generators.ts:20-50`: drop `cf-connecting-ip` and `x-real-ip` and keep the first XFF hop, falling back to the socket address. `apps/dashboard/src/lib/utils/proxy-api-request.ts:~117`: `upstreamHeaders.delete('cf-connecting-ip'); delete('x-real-ip')`. Optional: Caddy `request_header -CF-Connecting-IP -X-Real-IP`. |
| registration limiter = 1 global bucket (missed item) | `docker-compose.deploy.yaml` dashboard env: `ADDRESS_HEADER=x-forwarded-for`, `XFF_DEPTH=1`, so `getClientAddress()` in `(auth)/register/+page.server.ts:45` returns the real visitor IP instead of Caddy's. |
| process-exits-on-unhandled-rejection (part) | `apps/api/src/index.ts:30`: add `.catch(log)` to `preloadVerifiedCustomDomainOriginsRegistry()`. `apps/api/src/routes/agent/agent.ts:608-648`: wrap the `onFinish` body in try/catch. |
| agent-chat-no-limit-race (part) | `apps/api/src/routes/agent/agent.ts`: wire up the existing `agentChatKeyGenerator` and `agentUploadKeyGenerator` with `createRateLimiter` (for example 10/min and 200/day per user). |
| automation-key | `apps/api/src/middlewares/automation-key.ts:19-33`: make the `lastUsedAt` touch fire-and-forget (`void ... .catch`) and throttle it to once per 60s per key with an in-process Map. Move `await next()` outside the try/catch so downstream errors are no longer mislabelled 401. |
| worker dead-letter handlers (missed) | `apps/jobs/src/workers/{emails,notifications,media}.ts` `worker.on('failed')`: wrap `recordDeadLetterJob` in try/catch. |

- **Flows touched:** none functionally. Per-IP limits now actually work. Registration stops sharing one global bucket, so applicants stop seeing false 409/429 errors.
- **Edge cases:**
  - The SSR `PRIVATE_SERVER_KEY` exemption stays.
  - With XFF from Caddy, first hop and last hop are the same value. Revisit if a CDN is ever added.
- **Test:**
  - Unit test: a request carrying `cf-connecting-ip: 1.2.3.4` is keyed on the XFF value.
  - Sign in, register and invite preview still work.
  - `docker inspect` shows the log options.
  - `grep -r "console.log('headers'"` finds nothing.
- **Rollback:** revert the commit. Compose logging can be removed independently.
- **Your decision #13:** if the logs were ever shipped or shared anywhere, consider rotating all sessions.

### Phase B: Database indexes while the tables are still tiny (S effort)
**WHY:** with about 40 learners every table is tiny, so a plain `CREATE INDEX` takes milliseconds and blocks writes for no noticeable time. Later the same indexes would need the hand-run `CONCURRENTLY` process. **IMPACT:** none visible; this only makes later phases faster.

**Process (from migration-safety):**
1. Write one drizzle migration with `CREATE INDEX IF NOT EXISTS`. Index names must match `packages/db/src/schema.ts` exactly so that `drizzle-kit generate` shows no diff.
2. In `packages/db/src/scripts/db-setup.ts`, add `SET lock_timeout='5s'` and `SET statement_timeout='60s'` for the migrator session, so a blocked migration fails fast instead of crash-looping the API.
3. Document the future large-table process in `docs/DEPLOY.md`. When a table passes about 100k rows: hand-run `CREATE INDEX CONCURRENTLY IF NOT EXISTS` through the 5432 session pooler (one statement per call, not inside a transaction), check `pg_index.indisvalid`, then commit the matching `IF NOT EXISTS` migration.

**Indexes to add (declare each in `schema.ts`):**

| Index | Serves (finding ids) |
|---|---|
| `groupmember (profile_id, role_id) INCLUDE (group_id)` | groupmember-profile-index, groupmember-profile-lookups: `isCourseTutorForLearner`, tutor_allocation→groupmember joins, `getEnrolmentsForLearners`, `getCoursesForLearners`, `listAnnouncementsForLearner`, profile-delete FK scans |
| `groupmember (group_id, role_id) INCLUDE (profile_id)` | per-course student counts and lists (`getOrgCoursesWithEnrolment`, people, dash stats) |
| `session (user_id)` | session-account-verification-indexes, last-seen-lookup, `deleteSessionsByUserId`, FK cascade |
| `session (expires_at)` | the purge job in Phase J |
| `account (user_id)` | better-auth sign-in, password change and user delete |
| `verification (identifier)` and `verification (expires_at)` | lookups and purge |
| `notification (user_id, created_at DESC)` | notification-index-and-fanout (bell list) |
| `coursework_submission USING gin (files jsonb_path_ops)` | coursework-file-key-jsonb (every coursework download) |
| `coursework_result USING gin (feedback_files jsonb_path_ops)` | same (feedback downloads; no learner column on that table) |
| `course_section (course_id)` | every course and outline load, plus cascade deletes |
| `lesson (section_id)` | join and cascade path |
| **Partial UNIQUE** `registration (organization_id, email) WHERE status='pending'` | registration-pending-unique. **Only after Phase 0 query #3 returns zero rows.** If it finds duplicates, deleting them is a data operation that needs your approval. Emails are already stored lowercased, so `lower()` is not needed. |

Plus code to go with the registration index: `packages/db/src/queries/registration/registration.ts:26-75` changes `insertRegistration` to `onConflictDoNothing().returning()`. An empty result maps to the existing "already registered" response with the same shape.

**Explicitly NOT added:** see the "Do NOT change" list.
- `session(updated_at)`
- `organization_id` indexes on `tutor_allocation` and `message_thread` (single org)
- the quiz-stack indexes (quizzes are probably unused; confirm counts in Phase 0)
- `message(thread_id, created_at DESC)`: the existing `(thread_id, created_at)` index scans backwards fine
- the speculative coursework_submission composite. Revisit only with EXPLAIN evidence after Phase F.

- **Flows touched:** none semantically. Public registration form: a duplicate submission still shows the same message.
- **Edge cases:**
  - Never drop `unique_group_profile` or any other unique constraint.
  - If the GIN index adds noticeable write cost on submit, it is still only one row per submission.
- **Test:**
  - Migrate a fresh local DB, then run `drizzle-kit generate` and expect no diff.
  - `EXPLAIN` on `isCourseTutorForLearner`, `getLastSeenForUserIds` and `getSubmissionByFileKey` shows index use.
  - Double-submit the registration form and confirm one row.
- **Rollback:** a down migration with `DROP INDEX IF EXISTS` per index. These are additive only.

### Phase C: Stop repeating per-request lookups (M effort, the biggest DB win)
**WHY:** this removes the 335k organization/plan/"first org" queries and the 166k storage lookups, and cuts identity work from 3 queries to 1 per request. **IMPACT:** every page and click gets faster. Branding changes appear within about 60s instead of instantly.

**C1. Dashboard root layout** (root-layout-org-og-per-nav, og-head-and-warm-fetch-per-navigation, ssr-session-and-org-per-navigation)
- `apps/dashboard/src/routes/+layout.server.ts:28-47`: **delete the per-request `void fetch(warmUrl)`**. The lazy `/org-site/og/:siteName` route still serves link-preview scrapers.
- `apps/dashboard/src/lib/features/app/layout-setup.ts:28-41`: add a module-level TTL cache (60s) with in-flight single-flight around `getFirstOrg` / `getOrgBySiteName` / `getOrgsByCustomDomain`, keyed by `mode|siteName|hostname`.
  - **Never cache null or errors for more than about 2s.** Otherwise a short API blip leaves the login page stuck with no org.
- `apps/dashboard/src/lib/utils/functions/metaTags.server.ts:141-144`: wrap the `url.pathname`/`url.origin` reads in `untrack`, so client navigations no longer re-run the root server load. Canonical and og:url stay server-rendered.
- `apps/dashboard/src/lib/utils/functions/org-site-og-url.ts`: memoise the CDN HEAD result per siteName for 10–60 minutes, including negative results. It only runs if `PUBLIC_MEDIA_CDN_URL` is set, which prod does not set today.
- `+layout.server.ts:15-24,52-60` (root-layout-ships-locals): trim the returned `locals`.
  - Strip `session.token`, `ipAddress`, `userAgent`, and the organizations[] plan payload if unused.
  - Keep `user`, `profile.locale`, `orgRoles`, `status`, `actor`.
  - First grep every consumer: `init.svelte.ts` (`setupApp`, `isMemberOfOrg`, `currentSession`), `+layout.ts`, `(app)/+layout.svelte`.

**C2. API org/OG caching**
- `apps/api/src/routes/organization/organization.ts:114-128` → `getFirstOrganizationWithPlans` (`packages/db/src/queries/organization/organization.ts:~950`): in-process 30–60s TTL cache. The same helper also serves signup-guard, profile.ts, registration.ts and resolve-verification-org.ts. Invalidate on org update and plan writes within the API process; the TTL covers other processes.
- `apps/api/src/services/org/og.ts:37-73`, `og-cache.ts:12-61`: in-memory `{etag, buffer}` cache per siteName (5–10 min) plus single-flight around `getCloudflarePngBuffer`. When `mediaPublicBaseUrl` is unset, `persistOrgSiteOgImage` should log a warning instead of silently returning null. That silent null means paid Cloudflare renders on every warm call.

**C3. SSR session call** (ssr-session-per-request-no-timeout, custom-session-swallows-db-errors, dashboard side)
- `apps/dashboard/src/lib/utils/services/auth/session.ts:7-52`:
  - Add `AbortSignal.timeout(4000)`.
  - Return a **tri-state** (`session | none | error`).
  - Add a memo with a 3–5s TTL keyed by sha256 of the cookie string. Max about 5k entries. Never memoise `none` or `error` for more than about 1s.
- `apps/dashboard/src/hooks.server.ts:97-114`:
  - On `error`, render a retry/error page and **do not** redirect to `/login`. The login page itself calls get-session, so a redirect could loop.
  - Do not fire `session_invalid_bounce` for transport errors.
  - Evict the memo entry when the proxy forwards `/api/auth/sign-out` or `/api/auth/sign-in`.
- `apps/dashboard/src/lib/features/app/init.svelte.ts`: only auto-join an org when the membership lookup **succeeded** and came back empty.

**C4. API identity: 3 queries to 1, with no cache and no staleness** (authz-double-resolution, per-request-auth-pipeline)
- `packages/db/src/auth.ts:274-325` (customSession `fn`): replace the two selects with **one** `organizationmember JOIN profile` query for the user. Put its result in a per-request memo (AsyncLocalStorage, or a WeakMap keyed on the request `Headers`).
- `packages/db/src/actor.ts:18-43` (`resolveActor`):
  - Accept the memoised rows when present, and fall back to a query otherwise.
  - Add `ORDER BY organizationmember.created_at` so multi-org users get a deterministic org. Today there is no ORDER BY.
  - Before changing the signature, check the exact Actor shape in `actor.ts`.
- `apps/api/src/app.ts:110-153`:
  - The middleware now reuses the memo, so `/api/auth/get-session` stops paying twice.
  - Keep `/api/auth/get-session` exempt from the rate limiter as it is now.
  - **Do not** skip the global middleware for `/api/auth/*`. That would change the rate-limit key from user to IP for offices behind one shared IP.
  - Wrap `resolveActor` so that a DB error returns **503 + Retry-After**, not 500, and never 401.
- `packages/db/src/auth.ts:283-298`: on DB error, **rethrow**. Do not return `{orgRoles:{}, status:'ACTIVE'}`; the code must stay fail-closed.
  - Keep the `status` default only for the "row not found" case.
- Fix the misleading comments at `auth.ts:276-278` and in `org-member.ts`, `org-admin.ts`, `org-team-member.ts`.
- `/api/auth/get-session` JSON shape stays **identical**, because the dashboard's `getActor` reads it.
- **Allocation is untouched:** `isTutorAllocatedToLearner` and friends stay uncached per-route queries.

**C5. Small cheap caches**
- `apps/api/src/middlewares/guards/org-binding.ts:19-36` (org-binding-and-uncached-lookups): LRU for courseId→orgId with a 10-minute TTL, evicted on course delete. Membership and allocation decisions are not cached.

- **Flows touched:** all roles, all pages.
- **Edge cases:**
  - Deactivation: status is still read fresh on every request (the memo is per request only), so it bites on the very next request, as ACCESS.md requires.
  - Role change: same.
  - Logout: memo entry evicted.
  - Custom domains: cache keys are per host, so tenants never cross.
  - Impersonation: keyed by the session's own user id.
- **Test:**
  - Unit test: deactivate a user, then a request immediately after returns denied.
  - Unit test: role change takes effect on the next request.
  - Unit test: when the get-session fetch times out, the user sees the error page, not `/login`.
  - Compare `pg_stat_statements` before and after: organization queries per page view should be about 0, identity queries per request about 1.
  - Click through admin, manager, tutor and learner flows on localhost.
- **Rollback:**
  - Each sub-item (C1–C5) is its own commit.
  - The caches can sit behind an env flag (`ORG_CACHE_TTL_MS=0` disables them).

### Phase D: Background pings (S–M effort)
**WHY:** the steady background load grows with the number of open tabs, even when nobody is looking at them. **IMPACT:** the notification badge may be up to 60s stale when a tab comes back into focus, and it refreshes immediately on return. Hidden tabs drop out of "Online now" after 5 minutes, which is the intended behaviour.

| Item | File / change |
|---|---|
| polling-no-visibility-pause, heartbeat-* | `apps/dashboard/src/routes/(app)/+layout.svelte:32-42`, `notification-bell.svelte:17-46`, `header-context.svelte:11-17`, `admin-dashboard.svelte:36-44`: one shared poll helper that pauses while `document.hidden`, refreshes immediately on `visibilitychange` back to visible, adds ±20% jitter, and backs off on 429/5xx. **The heartbeat stays at 60s**, because the online window is 5 minutes. |
| header-context 403 loop (missed) | `header-context.svelte`: only poll the admin-only summary endpoint when the actor is an admin. |
| heartbeat conditional write | `packages/db/src/queries/organization/users.ts:105-108` `touchSession`: `UPDATE session SET updated_at=now() WHERE id=$1 AND updated_at < now() - interval '45 seconds'`. |
| unit-time-heartbeat-heavy | `apps/api/src/routes/course/lesson.ts:372-405`: (1) if `actor.role !== 'LEARNER'`, return early **before** `assertEnrolledStudentContentAccess`, an immediate saving for staff. (2) For learners, replace the heavy content assert with one query: the actor is an enrolled STUDENT groupmember of `:courseId` **AND** `lesson.course_id = :courseId`. The second condition stops time being written under the wrong course. Optionally also call `isUnitUnlocked` (cheap after Phase F). Keep the separate best-effort `unit_time_monthly` upsert in its own try/catch. Keep the 120s per-beat cap and the existing `unitTimeRateLimit`. |
| polling-fanout (server) | `apps/api/src/services/organization/management.ts:259-285` `getOrgSummary` and `services/dash/admin-overview.ts:344-364` online-now: a 15–30s per-org in-process single-flight cache. If the online user list is capped, `count` and `byRole` must be computed in SQL. |
| (optional, M) | A count-only `GET /notifications/unread-count` for the poll, with the full list loaded only when the popover opens. This needs a new API endpoint. |

- **Not done:**
  - Keep the admin-dashboard online poll (its panel lists users, which the summary cannot replace).
  - No Redis presence.
  - No `session.updated_at` index.
- **Flows touched:** the presence panel, the bell, learner study time (feeds tutor "time per unit" and admin study hours).
- **Test:**
  - Open a lesson as a learner and confirm `unit_time_spent` increments.
  - Forge a lessonId from another course and confirm a 404 and no row written.
  - Staff on a lesson write nothing.
  - Hide the tab and confirm no requests in DevTools; refocus and confirm one immediate refresh.
- **Rollback:** revert the commit. All changes are client- or route-local.

### Phase E: Correctness-at-scale bugs (each a small PR)
**WHY:** each of these is a functional failure, not a slowdown. **IMPACT:** fixes broken behaviour; nothing gets slower.

| Id | File / change | Edge cases |
|---|---|---|
| allocation-admin-picker-capped / assignable-people-capped-100 | `apps/api/src/services/organization/allocation.ts:38-41`: replace the 100-row dump with typeahead search. `getOrganizationUsers` already supports search and page; use limit 20, an org-scoped role filter and `requireManagerOrAdmin`, and exclude already-allocated pairs server-side. Paginate `listAllocationsByOrg` (`queries/allocation/allocation.ts:133-152`) with tutorId/learnerId/search filters and `ORDER BY created_at, id`. **Update every consumer of `getAssignablePeople`**: the allocation page (`allocation.svelte:150-175`, which becomes an async combobox) and the tutor-management `manage-courses-dialog`. | `createTutorAllocation` validation (`getOrgMemberRoleId`, 409 on duplicate, audit) is unchanged. Deactivated users are excluded. A learner with no profile row is filtered out. |
| messages-oldest-200 | `packages/db/src/queries/comms/message.ts:98-111` `listMessages`: inner `ORDER BY created_at DESC, id DESC LIMIT n`, then reverse. Optional `before` cursor (zod max 100). Inbox (`listConversationsForParticipant`, `getLearnerMessageSummary`): rewrite as a LATERAL "latest message per thread" using the existing `(thread_id, created_at)` index. Add a per-user send limiter of 30/min. | The UI stays oldest-first. Archived threads are still listed and read-only. Threads with no messages are omitted. A null read cursor means unread. `isParticipant` and the allocation checks in `services/comms/messaging.ts` are untouched. |
| reminder-dedupe-expires | **Interim (S):** in `packages/jobs/src/queues/defaults.ts:36-41`, emails `removeOnComplete {age: 48h}` with no count cap. Narrow the windows in `apps/jobs/src/processors/notifications/session-reminder-scan.ts`: send the 24h reminder only when `1440-30 < minutesUntil <= 1440`, and the 1h reminder only when `30 < m <= 60`. **Then (M):** add a ledger table `session_reminder_sent(lesson_id, profile_id, offset_minutes, lesson_at_epoch)` with a UNIQUE key, `INSERT ... ON CONFLICT DO NOTHING RETURNING`, and enqueue only when a row comes back. | Keying on the lesson_at epoch means a rescheduled session reminds again. A learner who enrols less than 24h before still gets the 1h reminder. Opt-outs are still honoured. |
| nested-pool-in-invite-tx | `apps/api/src/services/course/invite.ts:921-1050`, `packages/db/src/queries/course/invite.ts:22-24,214-232`: add a `dbClient: DbOrTxClient = db` parameter to `countInviteDistinctPreviewIps` and `createCourseInviteAudit`. Pass `tx` for the read and **both** ACCEPTED audits. **ABUSE_BLOCKED:** throw a typed AppError out of the transaction, catch it after the transaction, then write the audit on the pool. Pass `tx` to `assertStudentCapacityOrThrow` or run it before the transaction (cloud builds only). The same fix applies in `services/cohort/cohort.ts:266`. Add a unit or grep test: no bare `db` inside `db.transaction` callbacks in `apps/api/src/services`. | Failed accepts no longer leave false ACCEPTED audit rows. That is correct, but the invite audit stats will drop slightly. |
| learners-report-org-progression (Manager 403) | `apps/api/src/services/progression/progression.ts:162-168`: allow MANAGER for the org-wide builder that the reports use, **or** change the `/reports/learners` route to `requireAdmin`. See decision #12. | Managers already see org-wide read-only data. Confirm the Learner Progressions page keeps its intended guard. |
| system-events-report | `apps/api/src/services/dash/system-events.ts:31-41`: replace the second 2000-row fetch with `count(*) FILTER` over the last 24h, and compute severity totals with a grouped count that uses the page's WHERE. `queries/system-events/system-events.ts:63-71`: batched purge (`DELETE ... WHERE id IN (SELECT id ... LIMIT 5000)` in a loop), returning a count instead of ids. | The totals change meaning from "rows on this page" to "rows matching the filter"; check the UI labels. |
| compliance expiry .catch in tx (missed) | `apps/api/src/services/course/compliance.ts:~620-650`: the duplicate-key `.catch` inside `db.transaction` silently aborts the whole transaction. Use `ON CONFLICT DO NOTHING` on `createCourseCompletionRecord`, or a savepoint. | Only relevant if compliance courses are used. |
| submissions-grid stale | `apps/dashboard/src/routes/(app)/caseload/courses/[courseId]/submissions/+page.svelte`: set `submissionsGrid = null` when the assessment changes, and show an error state with a Retry button. | Keep the reqId guard. |
| api-client-retries-all-methods | `apps/dashboard/src/lib/utils/services/api/index.ts:105-241`: retry only GET/HEAD on 502/503/504 and network errors, use a fresh timeout per attempt, and add jitter. | Some flows may have relied on a silent POST retry after a deploy; the new error snackbars are the replacement. |
| usersapi-list-drops-search | `apps/dashboard/src/lib/features/users/api/users.svelte.ts`: store `this.search`, add a request counter. | Admin only. |
| notify-session-update error policy | `apps/jobs/src/processors/notifications/notify-session-update.ts`: rethrow or collect failures like notify-course-exercise does. The keys already include the sequence number. | |

- **Test:** each item gets a localhost reproduction.
  - Seed 150 learners and confirm all can be allocated.
  - Seed 250 messages and confirm the newest are shown.
  - Fire 12 parallel invite accepts and confirm no hang.
  - Run the reminder scan twice, 7 hours apart, and confirm one email.
- **Rollback:** one PR per item, revert as needed. The ledger table is additive.

### Phase F: Learner progress batching (M effort, highest learner-facing win)
**WHY:** learner home, the feedback prompt and marking currently cost about 2 queries per unit, 3 times per home load. Inside the marking transaction this holds a connection for the whole walk. **IMPACT:** learner home and marking get noticeably faster, and **the numbers must stay identical**.

**F1. Batched primitive** (progress-n-plus-one, per-unit-roundtrips-progress, progress-n-plus-1-units)
- New function in `packages/db/src/queries/coursework/coursework.ts`: `getPassedLessonIdsForLearnerCourse(learnerId, courseId, client: DbOrTxClient = db)`.
  - Query 1: assessment keys for the course's lessons, via the existing `getAssessmentKeysByLesson`.
  - Query 2: `DISTINCT ON (lesson_id, assessment_key)` over the learner's latest **FINAL verdict**, filtered by the course's lessonIds (not only `submission.course_id`).
  - Query 3: for **untagged units only**, reproduce `getLatestMarkedResult` exactly. That means the highest-version submission with **any** result row, with no final/verdict filter and any assessment_key; draft feedback rows can decide these units today.
  - Evaluate with the existing `isPassingResult`. A unit passes if **every** tagged key passes.
- **PARITY TRAP:** do **not** reuse `assembleReportRows`' legacy rule. It is not equivalent.
- Keep `hasLearnerPassedUnit` with its signature unchanged and add the batched variant next to it. Then switch these callers one at a time:
  1. `packages/db/src/queries/progress/progress.ts:80-94` `computeLearnerCourseProgress`
  2. `packages/db/src/queries/completion/completion.ts:29-41` `isCourseComplete`, which is called inside `recordResult`'s transaction. **Pass `tx`** so the just-recorded Pass is visible (read-your-writes).
  3. `apps/api/src/services/gating/unlock.ts:34-54` `getCourseUnlockMap` / `isUnitUnlocked`
  4. `apps/api/src/middlewares/guards/ownership.ts` (material unlock)
- `apps/api/src/services/lms/tutor-feedback.ts:17-23`: derive `passedUnits` from the same batched read. No Redis memo; batching alone takes about 62 queries down to about 3.

**F2. Material download guard** (material-download-guard-per-key, material-download-guard-and-unbounded-keys)
- `ownership.ts:298-312`: call `getMaterialKeyLessonMap` **once** and derive the key set from it. Evaluate unlock once per **distinct** lessonId, loading ordered units and the `sequentialUnlock` flag once.
- `packages/utils/src/validation/course/course.ts:150-156`: `keys.max(100)`, a per-key `.max(1024)`, and a `z.uuid()` courseId. Check the callers in `presign.svelte.ts` first.
- **Do not cache the material key set** (see the Do NOT change list).

**F3. Coursework download guard** (coursework-file-key-jsonb, coursework-download-guard-jsonb-seqscan)
- With the Phase B GIN indexes in place, `ownership.ts:371-392` only needs these changes:
  - Route by key prefix: `coursework/` goes to the submission table and `coursework-feedback/` to the result table, which removes the double scan.
  - Resolve keys in parallel (the 20-key cap stays).
  - De-duplicate `isAllocatedTutor` per learnerId within one request.
- Keep these behaviours:
  - All-or-nothing: any unknown or unreadable key gives a 403.
  - `canReadCoursework` runs on the **owning row's** learnerId, never on a learnerId parsed from the key.
  - The legacy containment fallback stays.
  - Malformed keys are denied.

- **Flows touched:** learner home, My Learning, the course outline lock hints, the completion trigger, certificates, material and coursework downloads.
- **Edge cases:** legacy NULL assessment_key; multi-item units; Refer after Pass (latest wins); drafts that can decide a legacy unit; exempt and optional units (`isNonGatingUnit`); sequential unlock on and off.
- **Test:**
  - Extend the existing progress, completion and unlock tests with an **old vs new equivalence** suite: run both implementations on seeded fixtures covering every edge case above, and they must match exactly.
  - Marking a final Pass triggers completion within the same request.
  - Allocated tutor, non-allocated tutor (403), learner self, admin, and Manager (denied for coursework) all behave as today.
- **Rollback:** callers switch one at a time behind `PROGRESS_BATCHED=true`, and the old helper stays in the code.

### Phase G: Fan-out and bulk operations (M effort)
**WHY:** broadcasts and imports currently run thousands of sequential or unbounded writes inside one web request. **IMPACT:** "Publish" and "Import" return in seconds instead of timing out.

| Id | File / change |
|---|---|
| announcement-sync-fanout / broadcast-fanout-serial-in-request / notification-index-and-fanout | `apps/api/src/services/comms/notify.ts:41-100`: add `emitNotificationBatch` that inserts in chunks of 500 multi-row INSERTs and falls back to per-row inserts if a chunk fails (failure isolation). `announcements.ts:182-212` uses it. This stays **synchronous** (5k rows is about 10 statements, around 1s). Add a double-publish guard: reject the same author/title/audience within 30s, or disable the Publish button while in flight. The audience resolution (`resolveRecipients`: tutor audience via `listLearnersForTutor`, learners role 3) is **unchanged**. In-app rows are always written. The email leg stays as it is today; see decision #1. |
| groupmember-bulk-enrol-race / bulk-enrol-unbounded-parallel | `packages/db/src/queries/group/group.ts:18-89`: chunk `getExistingGroupMembers` and `addGroupMembers` at about 500–1000 rows, use `.onConflictDoNothing({target:[groupId, profileId]})`, and wrap each call in one `runInTransaction`. Report the inserted and skipped counts from RETURNING. Fix the missing `await` in the try/catch (group.ts:25-33). `apps/api/src/services/organization/audience.ts:243-312`: one chunked insert for cohorts, and `mapWithConcurrency(…, 5)` (already in the file) for the email enqueues. |
| bulk-ops-hold-connections | `apps/api/src/services/cohort/cohort.ts:208-300`: one `email = ANY(...)` lookup and one membership lookup, then chunked inserts, while keeping the per-member `{added, errors}` result shape and the "already a member" text. **Do not add `.max(500)`** until the callers are checked; chunk on the server instead. `apps/api/src/services/course/compliance.ts:321-660`: use the array-accepting `getLatestComplianceRecordsByProfiles` and set-based updates. |
| worker-fanout-n-plus-one / shared preference cache | `packages/db/src/queries/notifications/email-preferences.ts`: add `prefetchPersonalSettings(profileIds, orgId)`. `apps/api/src/services/jobs/email-jobs.ts`: add an optional shared-cache parameter to `enqueueTransactionalEmail`. Use it in `notify-course-exercise.ts`, `notify-session-update.ts`, the newsfeed (pass profile ids so `getProfileByEmail` is never called), and `services/cohort/goal.ts`. |
| notify-exercise-spam | `packages/jobs/src/enqueue/notifications.ts:9-22`: jobId `notify-exercise:{courseId}:{exerciseId}:{15-min bucket}`. A duplicate click **returns the existing job id**, so the dashboard poll keeps working. Separately, derive the ICS MIME method from the ICS body (`packages/email/src/utils/services/nodemailer.ts:68`). |
| single-email-lane-starvation | `packages/jobs/src/enqueue/emails.ts`: map each template to a BullMQ priority (auth, invite and grade = 1; reminders and newsfeed = 10). `apps/jobs/src/workers/notifications.ts:21`: a separate `NOTIFICATIONS_WORKER_CONCURRENCY`. |

- **Flows touched:** admin broadcast, audience import, cohort add, course people, compliance assign, all outbound learner mail.
- **Edge cases:**
  - Keep the welcome-email idempotency keys `audience-course-welcome:{group}:{profile}`.
  - `assertStudentCapacityOrThrow` runs **before** inserts.
  - The cloud capacity check moves out of per-member transactions.
  - Bulk enrolment becomes all-or-nothing per call. This is a deliberate improvement: before, a failure halfway left partial enrolments.
- **Test:**
  - Broadcast to 5,000 seeded learners in under 5s, with one row per learner.
  - Double-click Publish and confirm one announcement.
  - Import overlapping with a concurrent enrolment completes with correct skip counts.
- **Rollback:** per-PR revert. No schema changes.

### Phase H: Admin, manager and tutor dashboards (M first, L later)
**WHY:** remove the "load every submission into JS, then repeat per tutor" pattern. **IMPACT:** admin pages get faster, and they stop slowing everyone else down.

**H1. Low-risk steps first (M):**
- `apps/api/src/routes/dash/stats.ts:195-199,275-286`: in-flight **single-flight** promise map per org, plus stale-while-revalidate on the existing 60s cache. Apply the same to `/reports/learners`, `/reports/completions`, `/reports/referrals`, `/reports/tutor-feedback`, `/compliance-overview`, `/stats`. The role check (`requireAdmin` / `requireManagerOrAdmin`) runs **before** the cache read. Keys are org plus report name; tutor views are never shared-key cached.
- New lean query `getSubmissionStatusRowsForLearners` in `coursework.ts`, with no `files`, `comment` or `feedback` columns. Use it in `computePipelineForRoster` and `getTutorCaseload`. The heavy variant stays for the learner-detail view.
- `apps/api/src/services/dash/admin-overview.ts:259-275`: load org submissions **once**. Build a learnerId→tutorIds Map from **one** `tutor_allocation` query, and partition in memory to get per-tutor stats. This keeps:
  - allocation-only scoping;
  - a learner with 2 tutors counting for each tutor but once org-wide;
  - the per-tutor roster with no org filter, and the org roster as STUDENT organizationmembers.
- Add a counts-only mode to `computePipelineForRoster` that skips the five item lists.
- Bound the remaining fan-outs to 3–4 at a time (a small in-file limiter, no new dependency).
- Overview course completion % (`admin-overview.ts:236-246`): use `course_completion` **joined to `groupmember` role 3** (only enrolled students), capped at 100, and label it in the UI. See decision #3.
- `progression.ts:236-243`: `getCourseProgressReport` returns or accepts pre-fetched results, so `getLatestMarkedResultsForCourse` runs once per course instead of twice.
- `packages/db/src/queries/analytics/analytics.ts:117-120`: stop swallowing errors. Return `{degraded:true}` or rethrow, so a database error does not silently mark every learner "never logged in". Compute the org last-seen map once and pass it into the pipeline.
- `caseload.ts:112,127`: replace `roster.find` with a Map.
- `services/caseload/course-view.ts:101-117`: add an optional `courseId` filter (safe, because lessons belong to one course).
- `stats.assignments` stays a **separate lean query over all course lessons**. Do not reuse `itemsByLesson`, which only covers lessons that have submissions.
- `apps/api/src/services/submission/submission.ts:315-377` (tutor-exercise-overview): resolve `visibleLearnerIdsForCourse` **first**. A TUTOR with an empty set returns `[]` immediately; never pass an empty `inArray`. Push `inArray(groupmember.profileId)` into SQL, and do one batched enrich instead of one per submission. Group answers by submissionId with a Map (`packages/db/src/queries/submission/submission.ts:76-90`).
- `resolve-roster-loads-full-roster-for-access-check`: add `canAccessCourse(actor, courseId)` that mirrors `resolveRoster` **exactly**: ADMIN true; TUTOR true only if an allocated learner is enrolled OR `isCourseTutor`; everyone else 403/401. Used by `getTutorUnitContent` and `signCourseMaterialsForTutor`.
- `queries/dash/admin-overview.ts` referrals: wrap the `DISTINCT ON` and count with `FILTER (WHERE result <> ALL($passing))`, passing `PASSING_RESULTS` as a parameter instead of the hard-coded `'PASS'`.
- `queries/dash/dash.ts:22-72` getCourseStats: pre-aggregate students, lessons and completions (completions counted against enrolled role-3 students only) and join them, keeping the completion formula. The sort order is decision #2.
- Dashboard: `caseload.svelte` loads `loadCaseload` only when `activeView==='learners'`. Remove the duplicate `announcementsApi.loadFeed()` (let BroadcastBanner own it). Announcements default to unarchived with limit 20; the admin manage page keeps `includeArchived=true`.

**H2. Later (L), only with a parity test:** rewrite the org-wide pipeline stats in SQL, keeping these semantics:
- pass/refer/totalGraded count every verdict row;
- overdue uses latestFinal;
- dueSoon uses latestFinal ?? latestDraft;
- avgTurnaround uses verdict rows where d≥0;
- assignments counts all lessons;
- DEACTIVATED learners count as suspended.

The same applies to the learners report in SQL, and to server-side pagination of learner-management, registrations, progression, the grid and allocation tables. Before paging the learner roster, CSV export needs its own server endpoint, otherwise it silently exports one page. KPI totals must stay independent of the page.

- **Flows touched:** admin overview, the marking/tutor performance/courses/learners/referrals reports, tutor caseload, the tutor course-content view, the exercise submissions overview.
- **Access rule:** every learner set still comes from `tutor_allocation` / `listLearnersForTutor` / `visibleLearnerIdsForCourse`, server-side. Clients never send learnerIds.
- **Test:**
  - Snapshot the overview and report JSON on a seeded dataset (200 learners, 5 tutors with an overlapping allocation, 3 courses, legacy NULL-key rows, a deactivated learner) **before and after**. The numbers must match.
  - Tutor A cannot see tutor B's learners in any endpoint.
- **Rollback:** per-PR revert. The lean query is additive.

### Phase I: Storage, video and uploads (M effort)
**WHY:** remove the "one click can crash the server" paths and speed up video. **IMPACT:** download-all starts immediately and stops timing out; video seeks stop hitting rate limits.

| Id | File / change |
|---|---|
| s3-client-no-timeouts | `packages/core/src/config/storage.ts:96-116` and `apps/jobs/src/config/storage.ts`: `NodeHttpHandler({connectionTimeout: 5000, requestTimeout: 60000 /* idle-based */, httpsAgent: new https.Agent({keepAlive: true, maxSockets: 200})})` and `maxAttempts: 3`. Jobs get a longer idle timeout for big video downloads. |
| zip-buffers-whole-archive / download-all-zip-in-memory | `packages/core/src/utils/zip.ts`, `apps/api/src/services/caseload/download-all.ts`: replace JSZip with a streaming zip (archiver or fflate `Zip`), STORE mode for pdf/docx/doc, prefetch up to 4 files. **Pre-checks before headers are sent:** empty → 404; over 200 files or 250 MB → 413 with the message "filter by learner". Failures partway through go into a `MANIFEST.txt`. De-duplicate same-named files within a learner folder (today one silently overwrites the other). Replace `getAssessmentSubmissions` with a slim latest-files query limited to the roster ids from `visibleLearnerIdsForCourse` (an empty roster gives 404, never "no filter"). Keep `sanitize()` (Zip Slip) and the "(2)" folder de-dupe. Dashboard: a longer per-request timeout for this call, and no 5xx retry (Phase E). |
| hls-per-segment-full-api-stack | `apps/api/src/app.ts:105-154`: add an early branch for `/hls/:assetId/*`. If the `cio_hls_<assetId>` cookie verifies by pure HMAC, skip `getSession`/`resolveActor` and use a separate generous limiter keyed by assetId plus IP instead of the 100/min user bucket. Invalid or missing cookies fall through to the full path unchanged. Keep the OPTIONS/CORS handling and `master.m3u8` `max-age=10`. Player (`lesson-video-player.svelte`): re-mint the cookie at about 10 minutes on a timer. **The TTL stays at 15 minutes** (decision #10). Fix the stale Cloudflare-Worker comment in `hls.ts`. |
| dashboard-proxy-buffers / proxy-buffers-25mb | `apps/dashboard/src/lib/utils/proxy-api-request.ts`: add `signal: AbortSignal.any([request.signal, AbortSignal.timeout(120000)])`, excluding the agent chat, HLS and download-all streams. API: hono `bodyLimit` of about 8 MB on `/media/image` and on the agent upload route, with a Content-Length pre-check. `/media/image`: a per-user upload rate limiter. **Learner avatars stay allowed.** Streaming the request body and lowering `BODY_SIZE_LIMIT` come later, after measuring the largest real course-save JSON. |
| presign-cache-ttl-vs-url-expiry | `packages/core/src/utils/s3.ts:16-17`: `PRESIGN_CACHE_TTL_SECONDS = 1500` (signed for 3600s). Change the player's `PLAYBACK_URL_REFRESH_MS` to match. |
| staff-can-sign-arbitrary-keys | `ownership.ts:260-289`: the materials route also rejects keys starting with `coursework-feedback/` and `exercise-recordings/`. These keys have their own guarded endpoints. No other change to staff bypass. |
| upload-presign-abuse-and-orphans | Primary: set Supabase bucket `file_size_limit` and `allowed_mime_types` (a dashboard setting). Cap video-recording size by max duration × bitrate in `services/exercise/video-recording.ts`. The orphan sweeper is **report-only** first; deleting anything later needs your approval. |

- **Flows touched:** tutor/admin download-all, all video playback (learner, tutor, admin, the public course page, the authoring preview), image uploads, every server-side storage read and write.
- **Edge cases:**
  - Download-all scope stays exactly "allocated ∩ enrolled" for tutors and all enrolled for admin. Manager is refused.
  - HLS with an expired cookie still works for logged-in members.
  - Range requests and HEAD requests are unchanged.
- **Test:**
  - Download-all with 50 seeded 5 MB files while watching `docker stats`: memory should stay flat.
  - A non-allocated tutor gets 403.
  - Play a 30-minute video and seek repeatedly: no 429s.
  - Upload an 8 MB image (413) and a 4 MB image (ok).
  - Stream a long S3 GET to confirm the idle timeout does not cut it.
- **Rollback:** per-PR. The HLS fast path sits behind the env flag `HLS_COOKIE_FAST_PATH`.

### Phase J: Resilience, jobs and retention (M effort)
**WHY:** blips in Redis, the database or email should degrade the site, not take it down. Tables should stop growing forever. **IMPACT:** nothing visible in normal operation; fewer outages.

| Id | File / change |
|---|---|
| redis-offline-queue-hangs (cache side) | **First**, in `apps/api/src/process-error-guards.ts`, add "The client is offline" to the transient-Redis pattern and **change `unhandledRejection` to log plus Sentry only** (keep exit on `uncaughtException`). Then wrap `redis.mGet` and `multi` in `packages/core/src/utils/s3.ts:71,114-125`, `services/dash.ts:126`, `services/analytics/reads.ts:54` and `utils/redis/oauth-handoff.ts` in `withTimeout(…, 1000)`. |
| redis-down-api-hang (BullMQ producers) | `packages/jobs/src/connection.ts:30-46,155-161`, `queues/factories.ts:16-29`: a separate **producer** connection (`enableOfflineQueue:false, maxRetriesPerRequest:1, connectTimeout:3000`, retryStrategy kept). Worker, blocking and scheduler connections stay as they are. Callers that need a job id return 503 "queue unavailable". The existing try/catch blocks keep swallowing errors for best-effort mail. Test a cold start. |
| ratelimit-redis-outage-adds-2s / rate-limiter-redis | `apps/api/src/middlewares/rate-limiter.ts`: if `!redis.isReady`, skip the check (fail open). Add a circuit breaker that skips Redis for 15s after 2 failures, and lower the timeout to 400 ms. Sign-in keeps Better Auth's own throttle. |
| no-graceful-shutdown (api + jobs) | `docker/entrypoint-api.sh:13`: `exec node apps/api/dist/index.js` (or `init: true`). `apps/api/src/index.ts`: keep the `serve()` handle; on SIGTERM call `server.close()` with a 25s deadline, then `closeDb()`, which is new in `packages/db/src/drizzle.ts` (`sql.end({timeout:5})`). `apps/jobs`: remove the six per-worker SIGTERM handlers and add one central handler in `index.ts` that closes all workers with `Promise.allSettled`, then `closeDb`, then exits. Jobs `uncaughtException` → exit 1. Compose: `stop_grace_period` of 60s for api and dashboard and 300s for jobs; dashboard `SHUTDOWN_TIMEOUT=30`. |
| smtp-no-pool-no-rate-limit | `packages/email/src/utils/services/nodemailer.ts`: `pool:true, maxConnections:3, maxMessages:100, rateLimit:${SMTP_RATE_PER_SEC}`. Add a BullMQ limiter on the emails worker. In `apps/jobs/src/processors/emails/send.ts`, classify errors: 4xx, ETIMEDOUT and ECONNECTION are retried; 5xx 550/553 and ZodError throw `UnrecoverableError`. Raise attempts to 8 and the first backoff to 30s. Log only the message id. **Never suppress auth templates.** Test ports 465 and 587 and ICS attachments against real SES. |
| auth-emails-inline (rest) | `packages/db/src/auth/email-password.ts:48-80`: forgot-password throws when `{success:false}`. Moving auth mail onto the queue happens only after the producer fix, and needs a direct-send fallback. |
| scheduler-jobs-no-retention | `apps/jobs/src/workers/maintenance.ts:101-135`, `notifications.ts:46-57`: template opts `removeOnComplete {count:50}, removeOnFail {count:200}`; the rollup gets `attempts: 3`, a cron schedule `'15 0 * * *'` under the same scheduler id, and a bounded 14-day catch-up from `max(date)`. Add count caps to `QUEUE_DEFAULTS.removeOnFail`. The one-off `Queue.clean` is a data operation and needs your approval. |
| maintenance-retention-not-wired / unbounded-tables / better-auth-table-growth | New batched (5k per batch, off-peak) purges in `maintenance.ts`: expired `session` (`expires_at < now()-1 day`), `verification` (`expires_at < now()`), `dead_letter_job` older than 90 days, read `notification` older than 90 days (**unread rows kept forever**). Retention for `analytics_page_event`, `media_job`, `job_step` and `email_delivery` waits for decision #5. **`audit_event` is never pruned.** |
| worker-shutdown-and-limits (jobs parts) | `apps/jobs/src/utils/ffmpeg.ts:46-70`: execFile timeout (30–60 min scaled by size), `-threads 1`, kill the child process on cancel. `reapStuckMediaJobs`: only reap rows with no active BullMQ job, or touch `updatedAt` from ffmpeg progress. |
| cron-scans-in-request | Turn `/internal/compliance/*` into thin enqueue endpoints. Add maintenance cron jobs with a jobId or advisory-lock single-run guard and chunked set-based updates. Cohort-goal reminder emails stay behind a flag (decision #11). |
| api-error-event-amplifier / event-log-write-amplification | `packages/db/src/system-events.ts`: throttle writes to one row per (eventType, path, status) per minute, with a count. Skip 401/403/404 in `app.onError` and in the dashboard's `handleError` report. Rate-limit `/log/client` per IP, even when the server key is used. **Security events (login failure, deactivated sign-in, rate-limited) are never sampled.** |
| process-exits (Sentry) | `apps/api/src/utils/errors.ts:61-109` `handleError`: for status ≥500, call `recordApiError` (and Sentry once enabled; see Phase K). |
| db-pool-and-timeouts (measured) | Step 1: `pg_stat_statements` `max_exec_time` from Phase 0. Step 2: `SET LOCAL statement_timeout='20s'` only inside known heavy report reads. A role-level timeout needs a dedicated `pearl_app` role (L effort, decision #9). **No `ALTER ROLE` on the shared role.** |

- **Flows touched:** all email, video processing, deploy restarts, the admin activity log.
- **Edge cases:**
  - Purges touch only expired rows, so nobody is logged out; impersonation sessions follow the same `expires_at`.
  - Rollup backfill is idempotent (UPSERT).
- **Test:**
  - `docker stop redis` on localhost: pages still load, presigned URLs are fresh, the email enqueue returns quickly, and the API stays up.
  - `docker stop api` during an upload: the in-flight request completes.
  - Run a purge on a seeded DB containing expired and live sessions.
- **Rollback:** per-PR. Each purge has an env flag that turns it off.

### Phase K: Infrastructure and deploy, with cost deltas (separate track)
Prices are rough list prices and must be confirmed. All changes are additive.

| Step | Change | Monthly cost |
|---|---|---|
| K1 (now) | **Interim:** `COMPOSE_PARALLEL_LIMIT=1` for builds; `docker/Dockerfile.dashboard:25` heap from 8072 to about 3072; confirm swap exists, otherwise add a 4 GB swapfile; weekly `docker image prune -af --filter until=168h` cron. | $0 |
| K2 (now) | **CI-built images:** a GitHub Actions workflow with buildx, the GHA cache and a push to GHCR tagged with the **git SHA** (keeps the AGPL rule that the deployed image is the pushed commit; build arg `PUBLIC_IS_SELFHOSTED=true`). Compose uses `image: ghcr.io/integer-training/pearl-<svc>:${IMAGE_TAG}`, and deploys are `docker compose pull && up -d`. **Rollback becomes `IMAGE_TAG=<prev> docker compose up -d`, which takes seconds.** The droplet uses a read-only pull token. | $0 |
| K3 (now) | **Smaller restart windows:** Caddy `reverse_proxy dashboard:3082 { lb_try_duration 30s; lb_try_interval 250ms }`. A one-shot `migrate` service (same api image, `restart: 'no'`) that api and dashboard `depends_on: service_completed_successfully`, with `SKIP_DB_SETUP=true` on api; this keeps role creation and the essential seed. A dashboard healthcheck. Migrations from now on are expand-then-contract only. | $0 |
| K4 (after a week of `docker stats`) | `mem_limit` plus a matching `--max-old-space-size` per service. Starting points: api 768m (heap 576), dashboard 768m, jobs 1200m with `cpus: 1.0`, redis 512m (`--maxmemory 400mb --maxmemory-policy noeviction`), caddy 128m. Set `DATABASE_POOL_MAX` and `JOBS_DATABASE_POOL_MAX` through compose and `.env.deploy.example`, along with `NODE_OPTIONS`, `SHUTDOWN_TIMEOUT` and the worker concurrencies. Add a connection budget table to `docs/DEPLOY.md`. **Do not raise the pool until the pooler `pool_size` is checked (Phase 0 #4).** | $0 |
| K5 (now) | **Backups:** confirm PITR and run the restore drill once; record the time it takes. Nightly `rclone sync --tpslimit 5` of the `documents` bucket to Backblaze B2 or DO Spaces with separate credentials. DO droplet backups. A copy of the production `.env` in a vault. Weekly snapshot of `caddy-data`. | +$5–10 (B2/Spaces) + about $4.80 (droplet backups) |
| K6 (now) | **Monitoring:** DO monitoring alerts (CPU >80%, memory >85%, disk >80%) and the pending uptime check. Sentry gated on `SENTRY_DSN` plus an opt-in env var instead of `!isSelfHosted` (`apps/api/src/instrument.ts:13`, `hooks.client.ts`), with `sendDefaultPii:false`, replay-on-error at 0 and traces at 0.05. A `/ready` endpoint (`select 1`, Redis PING) **for monitoring only**, never for autoheal. Set `QUEUE_DASHBOARD_PASSWORD` to enable the BullMQ Workbench. **Region check:** if Supabase is not in a London/EU region close to `lon1`, plan a move, because a cross-region hop multiplies every query. | $0 (Sentry free tier) |
| K7 (about 1k–5k learners) | `s-4vcpu-8gb` droplet; split `jobs-media` into its own container; Supabase compute Small/Medium; optionally a second small droplet for jobs/ffmpeg only. | +$24 droplet, +$15–60 Supabase, +$12–24 worker droplet |
| K8 (about 5k–20k learners) | Two app droplets behind a DO Load Balancer, managed Valkey, a dedicated worker droplet, Supabase Large, CDN for media. **Prerequisites:** Better Auth rate-limit storage moved to a Redis rate-limit-only store (not `secondaryStorage` sessions); a shared origin registry; Caddy `trusted_proxies` / real client IP designed; the graceful shutdown from Phase J. | about +$150–350 |

**Triggers for K7/K8:** p95 SSR above 800 ms, CPU above 70% sustained, memory above 80%, queue wait above 60s, or Supabase pooler use above 60% of its limit.

### Phase L: Deferred larger work (do only when the measurements call for it)
- Full SQL rewrites of the admin pipeline and learners report (H2, with parity tests).
- getEnrolledCourses driven from the learner.
- `profile.last_seen_at` denormalised.
- Redis presence.
- Message thread denormalised columns.
- Course payload split, with a `myMembership` field added first and readers migrated one at a time. RoleBasedSecurity, certificates, attendance and compliance all read `group.people`.
- Multi-stage, non-root images (after K2, gated on a smoke test).
- Dynamic import of `mediabunny` / hls-encoder in `video-card-dropdown.svelte` and `upload-video.svelte`, plus a bundle visualizer before touching the AI barrel.
- Agent attempts and caps, and per-org fairness.
- Dropping duplicate or unused indexes (only after `idx_scan = 0` over a representative period; never anything backing a unique constraint or an FK cascade).
- trgm search indexes.
- Organization_id indexes, if a second org ever appears.
- SSO transaction restructure (cloud only).
- Course-content caching.

---

## 3. Do NOT change

| Don't | Why |
|---|---|
| Index `session.updated_at` (or `(user_id, updated_at)`) | The heartbeat and better-auth update this column constantly. An index on it disables HOT updates, which bloats the table and amplifies writes. `session(user_id)` alone is enough. |
| Drop `unique_group_profile` or any UNIQUE or PK index | These enforce enrolment and allocation correctness and race protection. |
| TTL-cache authorization (orgRoles, status, actor) or any allocation check (`isTutorAllocatedToLearner`, `listLearnersForTutor`, `visibleLearnerIdsForCourse`) | ACCESS.md requires deactivation and role changes to apply on the **next request**. There are many writers, including direct SQL. The per-request memo in Phase C4 gives the speed without staleness. |
| Cache the current material key set | That set is the control that makes removed or cross-course files unretrievable. |
| Apply "default-deny by currency" to staff on the materials route | It breaks authoring of just-uploaded keys, media-manager previews and flat exercise-file keys. Only block the two prefixes listed in Phase I. |
| Use `allkeys-lru` or `volatile-lru` on the Redis instance | The eviction policy applies to the whole instance, and BullMQ requires `noeviction`. Separate cache/rate-limit Redis only at K8. |
| Disable Redis AOF | This loses BullMQ jobs on restart. |
| Move sessions into better-auth `secondaryStorage` | This changes where sessions live and breaks deactivation, impersonation and Online-now. |
| `ALTER ROLE ... SET statement_timeout` on the shared Supabase role, or a global hono `timeout()` | It would hit migrations, jobs and the SQL editor. hono's timeout does not cancel the handler, and it would cut AI chat, HLS and download-all. |
| Raise `DATABASE_POOL_MAX` blindly | The Supabase pooler `pool_size` limits real concurrency; raising the app's max only moves where requests queue. |
| Restructure `approveRegistration` into claim, onboard, then a compensating update | Today's rollback-on-failure behaviour is valuable. Approvals are human-paced. |
| `onConflictDoUpdate` the role on enrolment | It could downgrade an ADMIN or flip a TUTOR. Keep "skip existing". |
| A global unique on `notification(user_id, type, entity_id)` | session.unlocked and message coalescing rely on repeat rows. |
| Use `assembleReportRows`' legacy rule in progress batching | It is not equivalent to `hasLearnerPassedUnit` for untagged units. |
| A Redis memo on pass/complete results | Invalidation risk on the certificate/completion path; batching is enough. |
| Reuse `itemsByLesson` for `stats.assignments` | The number would silently drop. |
| Queue `emitNotification` only to save latency | The saving is tens of milliseconds and it adds failure modes. Chunked inserts are enough. |
| Turn on the announcement email leg as a "fix" | It would suddenly send thousands of emails. Decision #1. |
| Remove the admin-dashboard online poll | It feeds the user list, which the header count cannot replace. |
| Remove the hono access log entirely | It is the only request trace; correlationId lines are needed. |
| Add `organization_id` indexes on tutor_allocation and message_thread | Single org, so they have no selectivity. |
| Use CONCURRENTLY inside a drizzle migration | It errors there. Use plain `IF NOT EXISTS` while tables are tiny, and the hand-run process later. |
| Prune `audit_event`, or delete orphaned storage objects without a report first | Compliance trail and learner evidence; your approval is required. |
| Sign `ContentLength` into presigned PUTs | Supabase S3 compatibility is untested. Use the bucket size limits instead. |
| Put a CDN or load balancer in front before designing real-client-IP handling | All per-IP limits would collapse onto one IP or become spoofable. |
| Add `.max(500)` to cohort add without checking the callers | It could reject imports that work today. Chunk on the server. |
| Rewrite `getEnrolledCourses`, the course-member middleware, or the heartbeat UPDATE itself | Already served by `unique_group_profile`; the course count is small; the UPDATE is a cheap HOT update. |
| Rewrite `unit_time_monthly LIKE 'YYYY-%'` or the `extract(year…)` filters on their own | Tiny tables and no time index, so no gain. Change them only when touching those functions anyway. |
| Set `disableOfflineQueue:true` before fixing `process-error-guards.ts` | Otherwise "client is offline" errors would make the API exit. |
| Move canonical/og out of SSR | Crawlers need it. Use `untrack` instead. |

---

## 4. Decisions for you

Recommended option first.

1. **Announcement emails** (today they are never sent, because the code passes no email address).
   1. Keep announcements in-app only and fix the misleading comment. **Recommended now.**
   2. Wire up opt-in emails later, queued and batched (adds sending volume and cost).
2. **The "Top courses" card currently shows the 5 *least*-completed courses.**
   1. Change it to most-enrolled, highest first. **Recommended.**
   2. Keep the current order and rename the card "Courses needing attention".
3. **Course completion % on the overview.**
   1. Count recorded completions for currently enrolled students, labelled "completed (recorded)". **Recommended: fast and stable.**
   2. The live rule recomputed from current units (slower; changes if units are added later).
4. **Tutor email volume (one email per learner submission).**
   1. Keep as is for now. **Recommended.**
   2. Add a daily digest option for tutors.
5. **Retention periods** (deleting these rows needs your approval).
   1. Expired sessions and verifications after 1 day; read notifications 90 days (unread kept); dead letters 90 days; analytics page events 180 days (after rollup); job_step/media_job 90 days; audit_event kept forever. **Recommended.**
   2. Keep everything for now.
6. **Deploy images.**
   1. Private GHCR package with a read-only token on the droplet. **Recommended.**
   2. Public package.
7. **Off-site backup of coursework files.**
   1. Backblaze B2, about $5. **Recommended.**
   2. DO Spaces, about $5 + egress (same vendor as the droplet).
   3. None (current risk: unrecoverable learner evidence).
8. **When to upsize the server.**
   1. At the measured triggers (Phase K). **Recommended**, after Phases A–F, which remove most of the current load.
   2. Upsize to 8 GB now (+$24/mo) as a buffer.
9. **Database timeouts.**
   1. Targeted `SET LOCAL` timeouts on heavy reports only. **Recommended for now.**
   2. A dedicated `pearl_app` role with role-level timeouts (L effort, needs grants work).
10. **Video cookie lifetime.**
    1. Keep 15 minutes and add automatic re-minting. **Recommended.**
    2. 1–2 hours (simpler, but a copied cookie works longer after de-enrolment).
11. **Compliance and cohort-goal scheduled scans** (never run in prod today).
    1. Schedule the compliance expiry scan, and put cohort-goal reminder emails behind a flag until you approve. **Recommended.**
    2. Leave both unscheduled.
12. **Learners report for Managers** (currently 403 even though the route allows Managers).
    1. Allow Managers (read-only, consistent with the overview). **Recommended.**
    2. Make the route admin-only.
13. **Session cookies were written to the logs.**
    1. If logs were never shared or shipped off the droplet: delete the old container logs after Phase A. **Recommended if confirmed.**
    2. If unsure: also rotate all sessions (everyone signs in again once).
14. **Cookie-cache lifetime (affects how fast a password reset ends old sessions).**
    1. 5 minutes. **Recommended**: negligible cost, and a reset takes effect within 5 minutes instead of 1 hour.
    2. Keep 1 hour and correct the comment.
15. **Phase order.**
    1. A → B → C → E → D → F → G → I → H1 → J, with K1/K5/K6 in parallel and H2/L deferred. **Recommended.**
    2. Do the user-visible functional fixes in E first (allocation picker, chat, reminders), then A–D.

Every phase ends with the same verification: localhost run-through for admin, manager, tutor and learner; a `pg_stat_statements` comparison against the Phase 0 baseline; and your approval before anything is pushed to `main`.