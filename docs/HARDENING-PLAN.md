# HARDENING-PLAN.md — the Phase 10 register (hardening & security review)

The single findings register that runs Phase 10. Seeded from four inputs: the owner's UAT log, every recorded
debt across the phase docs (D1–D43), the upstream security scan + dependency audit (DEP-*), and a
web/auth hardening-baseline self-assessment (SA-*). Every entry is dispositioned **open** here and stamped
**fixed(commit)** or **accepted(rationale)** by the step that owns it. Nothing is left blank — this phase closes
the roadmap.

**Ground rule for the Step-2 sweep: FIND, do not FIX.** Findings merge here; Steps 3–4 fix; the second pass
re-verifies.

---

## Owner-confirmed operational values (2026-08-19 — "all recommended")

| # | Decision | Confirmed value |
|---|---|---|
| **O1** | Session lifetime + idle timeout | **7-day** session, **24h idle timeout**, keep 1h cookie-cache (was 30 days) |
| **O2** | Invite / reset token expiry | reset **1h**; **set-password invite 72h** (was 1h); email-verify **24h** |
| **O3** | Rate limits (config-driven) | login **10 / 15 min per IP**; password-reset **5 / hr per IP**; upload **30 / hr per user** |
| **O4** | Backup | enable **Supabase PITR** + **daily logical backup, 30-day retention**. *Owner action: confirm PITR is on the current Supabase plan / enable in the dashboard (Step 5 records the outcome).* |
| **O5** | Monitoring | **DO uptime check + email alert** on learn.epearlacademy.com (free tier) + a `/health` endpoint; no paid tooling |
| **O6** | BASELINE test failures | **fix** D1 (6 vitest load-failures) + **fix** D3 (stock script); **accept** D2 (dashboard has no unit suite — verified via svelte-check + E2E) |

---

## 1. Register

Severity: **blocker / major / minor**. Sec = security-relevant. Every row **open** until a step stamps it.

### Step 2 — whole-codebase sweep (find-don't-fix) re-examines these + surfaces new
| ID | Description | Source | Sec | Sev | Disposition |
|---|---|---|---|---|---|
| D5 | Child-object IDOR — lesson/section/newsfeed/lesson-language/exercise mutations key on the child id, not the path courseId; **lesson-comment edit/delete has NO author check**. Guarded at path course/cohort team-member scope. | ACCESS §4-B/C | Y | major | open |
| D6 | Loose link-invite / auto-join self-join at the invite's role, no email-match/approval; **link-invite token = 100-year, reusable** (auth self-assessment). | ACCESS §1.2, §4; SA-6 | Y | major | open |
| D7 | Dashboard-layer authz gaps on deferred routes (admin shell renders for any authed user; unanchored public-route regex; orgId trusted from slug cookie; silent-empty on 403). API is the enforced boundary → limited. | ACCESS §4 dashboard-layer | Y | major | open |
| D4 | Presign residual — flat `nanoid()` keys, no course-scope bind; exercise-upload shares the flat-key endpoint. Heavily mitigated (requireActor + currency + gating). | ACCESS §4-H | Y | major | open |
| D14 | Unauth outbound-email DoS — anonymous `POST /course/:courseId/payment-request` + `POST /unsplash` (email/abuse amplification). | PHASE1 findings; ACCESS §4-J | Y | major | open |
| D16 | Quiz `exercise/:exerciseId` GET/submission not gated by `isUnitUnlocked` (no iCQ quizzes today; seq-unlock default off). | PHASE4 §4 | Y | minor | open |
| D28 | Org-less authed user auto-enrolled as STUDENT into the first org (`profile.ts:53-68`). | CODEMAP §11.1 | Y | minor | open |
| D8 | sso()/tokenExchange() inert JIT vectors — gated self-hosted-off; review if ever enabled. | ACCESS §1.2; INTEGRATIONS A2/A3 | Y (latent) | minor | open |
| D9 | Quiz per-`quizId`→org residual bind (part of deferred child-id binding). | ACCESS §4.1 E | Y (low) | minor | open |
| D10 | Asset/HLS/transcript endpoints self-authorizing (org-member scoped; dual HMAC-cookie path). | ACCESS §4.1 J; §3b | Y | minor | open |
| D17 | `isUnitUnlocked` fail-open on a foreign lessonId (`ownership.ts:175`) — only reachable for a non-course lesson the content layer already rejects. | PHASE4 §4 | Y (low) | minor | open |

### Step 3 — hardening baseline
| ID | Description | Source | Sec | Sev | Disposition |
|---|---|---|---|---|---|
| SA-1 | **Dashboard HTML document missing HSTS, X-Content-Type-Options (nosniff), Referrer-Policy, Permissions-Policy** (Caddyfile does only reverse_proxy; API `secureHeaders` doesn't cover the HTML). Add via Caddy and/or hooks.server.ts. `frame-ancestors 'self'` already present. | SA §1; D36 | Y | major | open |
| SA-1b | CSP keeps `'unsafe-eval'`+`'unsafe-hashes'` (script) and `'unsafe-inline'` (style) (svelte.config.js:38-40) — weakens XSS. Tighten where SvelteKit allows; document any that must stay. | SA §1 | Y | minor | open |
| SA-2 | Cookies OK (httpOnly + lax + secure-in-prod). Make `useSecureCookies` explicit for prod; consider sameSite **strict** for the session cookie. | SA §2 | Y | minor | open |
| SA-3 | CSRF present at 3 layers (BA trustedOrigins + API CORS + SvelteKit action origin-check). Tighten the broad `*.classroomio.com`/`*.myclassroomio.com` wildcard trusted-origins for a self-hosted build; add a CSRF regression test on a dashboard action + an API POST. | SA §3 | Y | minor | open |
| SA-4 | Rate limits — login = BA in-memory 3/10s (weak, per-process, resets on restart); **password-reset only generic 100/10s (reset-email flooding)**; **upload presign has no dedicated limiter**; custom limiter is prod-only + fails-open + skipped for internal SSR key traffic. Add config-driven limits per O3 (login/reset/upload), Redis-backed for prod. Includes **D14**. | SA §4 | Y | major | open |
| SA-5 | Error hygiene GOOD (500s generic, no stack/internal leak). **Confirm + add a regression test**; verify the public-API + dashboard error paths. | SA §5 | Y | minor | open |
| SA-6 | Session/token — apply O1 (session 30d→7d + 24h idle) + O2 (invite 72h, verify 24h). The **100-year reusable link-invite** (D6) reviewed here. | SA §6 | Y | major | open |
| D29 | **Split-env footgun** — `PUBLIC_IS_SELFHOSTED` must match in api + dashboard (build-time); a mismatch makes the API behave as cloud (opens signup) while the UI renders self-hosted. Add a startup assertion. | CODEMAP §11.2 | Y | major | open |

### Step 4 — dependencies + upstream
| ID | Description | Source | Sec | Sev | Disposition |
|---|---|---|---|---|---|
| DEP-CRIT | **10 unique critical.** Priority: **better-auth + @better-auth/sso → ≥1.6.22** (clears both criticals — OAuth refresh-token replay, SSO SSRF — + 8 highs). Then tar ≥7.5.19, seroval, jspdf ≥4.2.1, fast-xml-parser ≥5.3.5, handlebars ≥4.7.9, shell-quote ≥1.8.4, vitest ≥3.2.6 (dev-only). | UpstreamScout audit.json | Y | blocker/major | open |
| DEP-HIGH | **145 unique high.** Clusters: better-auth (cleared by the bump), kysely + drizzle-orm SQLi, hono/@hono/node-server (JWT-alg-confusion, serveStatic, CORS-credential-reflect), axios → ≥1.16.0, samlify, node-forge, undici, @sveltejs/kit ≥2.57.1, nodemailer. Fix in triage order; suite-green after each cluster; document any accepted exception. Build/dev-time DoS tail last. | UpstreamScout | Y | major | open |
| UP-1 | Upstream cherry-picks: **NONE eligible** (46 commits, no genuine security fix). `fcbf38f6a` (auto-enroll role-downgrade) reviewed → N/A (self-hosted auto-enroll closed). Record in FORK.md. | UpstreamScout; FORK.md | Y | minor | open |
| D39 | Stripe dormant dependency (`stripe@^14`, no runtime import) — remove. | INTEGRATIONS C3 | N | minor | open |
| D40 | Dead `webhooks` BullMQ queue (no worker/producer) — remove/inert. | INTEGRATIONS W4 | N | minor | open |

### Step 5 — restore drill + runbook + monitoring
| ID | Description | Source | Sec | Sev | Disposition |
|---|---|---|---|---|---|
| RUN-1 | Perform a **real** DB (+ sample storage-object) restore into a scratch target, verified against a checklist; timings + evidence → **docs/RUNBOOK.md** (with deploy-rollback, incident basics, health checks). | exit criteria | N | major | open |
| RUN-2 | Configure the DO uptime check + email alert (O5); add a `/health` endpoint if absent → RUNBOOK.md. Enable Supabase PITR + daily backup (O4). | O4/O5 | N | major | open |

### Step 6 — log hygiene + volume sanity
| ID | Description | Source | Sec | Sev | Disposition |
|---|---|---|---|---|---|
| LOG-1 | PII-in-logs sweep — grep `console.*` for email/name/token/password/PII values across api+jobs+dashboard; live-sample a run; fix any leak. | exit criteria | Y | major | open |
| VOL-1 | Seeded-volume sanity — a few hundred learners on scratch data; caseload, reports, course outline behave (perf-sanity only, no optimisation). | exit criteria | N | minor | open |

### Step 7 — seals + reviewer + close
| ID | Description | Source | Sec | Sev | Disposition |
|---|---|---|---|---|---|
| D1 | **BASELINE F1** — 6 vitest test files fail to LOAD (`agent-lesson-content`, `ai-credits-usage`, `balance-answer-positions`, `course-go-live-readiness`, `question-update`, `reset-member-course-progress`) via the `@cio/core`/`@cio/db` wildcard-subpath resolver quirk (files exist in dist). **FIX** (vitest resolver config) per O6. | BASELINE §F1 | N | minor | open |
| D2 | **BASELINE F2** — dashboard jest can't start (TS1295 verbatimModuleSyntax); 0 dashboard tests. **ACCEPT** per O6 (dashboard verified via svelte-check + E2E; no unit suite). | BASELINE §F2 | N | minor | open |
| D3 | **BASELINE F3** — stock `@cio/api` test script passes NODE_ENV as a positional filter. **FIX** (trivial) per O6. | BASELINE §F3 | N | minor | open |
| SEAL-1 | Final egress audit == INTEGRATIONS.md exactly (re-run the Phase-0 method). | exit criteria | Y | major | open |
| SEAL-2 | deployed==pushed (the D32 redeploy decision) + FORK.md modifications summary current + AGPL source link intact. | exit criteria; FORK.md | Y | major | open |

### Owner/product items — recorded, owner-owned (not builder-fixed this phase)
| ID | Description | Sev |
|---|---|---|
| D32 | **PROD HELD at the Phase-0 build** — public self-signup is still OPEN in production until a container rebuild. The closing redeploy decision (Step 7). | major (owner) |
| D33 | Real prod SMTP (AWS SES via the Pearl Email Engine) — owner, end-of-project. | major |
| D34 | Real iCQ Level 5 content not entered (DEMO course is the proxy) — owner data task. | major |
| D35 | Email branding (~14 ClassroomIO strings) — deferred rebrand pass. | minor |
| D37 | `media` bucket public-read (images/avatars/thumbnails) — follow-up if image privacy needed. | minor |
| D30 | Media-worker ffmpeg crash (transcode/thumbnail) — 2 workers only, not exercised. | minor |
| D31 | `apps/docs` needs Node ≥22.12 (repo pins 20); not deployed. | minor |
| D21 | laserlearning archive import — decision open. | minor |
| D24 | Manager-UI reach for ID-verification recording (API allows Manager; UI on tutor caseload only). | minor |
| D25 | Polar UI dead references (3 plan-gated strings → removed routes). | minor |
| D26 | Non-deployed `apps/website` UserJot/Senja widgets (latent; not shipped). | minor |
| D41 | COURSE-MODEL.md line citations drift. | minor |

### Accepted-with-rationale (confirmed exceptions — not fixed)
| ID | Rationale |
|---|---|
| D11 | Legacy cookie-cached role middlewares — 1h role-lag on deferred surfaces; **NOT** a deactivation bypass (status-change deletes live sessions + `session.create.before` blocks re-login). |
| D12 | Role-model sprawl — authoritative sources are `organizationmember.roleId` + `groupmember.roleId`; Phase-1 collapsed its surfaces into `resolveActor`; legacy variants persist on deferred surfaces (mitigated by D11 rationale). |
| D15 | Manager provider-wide reports (`requireManagerOrAdmin`) — intended since Phase 5. |
| D18 | Results immutable in MVP — a later Refer is the correction path (product design). |
| D20 | Completion boolean in two code paths — cross-linked, product design. |
| D22 | Notifications/messaging/preferences not audited — self-only operational state, no privileged-decision value. |
| D27 | One-org 403 self-hosted carve-out — deliberate closed-system posture. |
| D38 | Certificates/Cloudflare rendering unused — certificates explicitly out of scope. |
| D42 | Analytics gating flaw — **RESOLVED** Phase 0 (analytics stripped, egress-audited). |
| D43 | Deactivated-session-lives-30-days — **RESOLVED** Phase 1 (status + live-session delete + login-block). |

---

## 2. Step 2 workflow design (find-don't-fix)

A `/workflows` fan-out — **one READ-ONLY agent per surface lane**, each returning findings as
`{finding, file:line, severity, suggested-fix-class}` — then a **second verification pass** re-checks each
surface after Steps 3–4 land. **Step 2 finds and does NOT fix.** Lanes:

1. **auth/session** — better-auth config, session/cookie/CSRF, the JIT vectors (D8), split-env (D29), link-invite.
2. **API vs ACCESS.md** — every route's guard vs its ACCESS.md row; deferred authz (D4–D12), unauth surfaces (D14), gating gaps (D16).
3. **dashboard loads/actions** — server-load guards, form-action CSRF, the dashboard-layer gaps (D7).
4. **storage & file handling** — presign key scoping (D4), upload validation, public `media` (D37), download authz.
5. **jobs** — BullMQ processors: input trust, PII in job data, the dead webhooks queue (D40).
6. **templates / XSS** — email templates + any dashboard `{@html}` / unsanitised rich-text render.
7. **query construction** — raw SQL / `sql\`\`` interpolation, drizzle/kysely identifier injection (the SQLi CVEs).
8. **secrets handling** — no secrets in git/logs/client bundle; env handling; PII-in-logs precursor (LOG-1).

Findings from each lane merge into §1 with a disposition; Steps 3–4 fix; the second pass must re-verify clean.

## 3. Flagged-not-built (future decisions — none built this phase)

Audit-log viewer · subject-access-request (SAR) / data-export tooling · retention-policy automation · bulk CSV
import · **third-party penetration test** (recommended as an optional external follow-up in the closing report).

## 4. Verification (this step)

No tests. Reconciliation: every "debt / deviation / accepted / deferred / known / pre-existing / PARTIAL /
follow-up / gap" mention across `docs/PHASE*.md`, `BASELINE.md`, `ACCESS.md`, `INTEGRATIONS.md`, `FORK.md` maps to
a register row above (D#/SA#/DEP#/O#). Owner values O1–O6 confirmed 2026-08-19.

---

## 5. Step-2 whole-codebase sweep — findings (2026-08-19)

A `/workflows` fan-out ran **8 READ-ONLY lanes** (find-don't-fix). **57 findings — 0 blockers, 12 major, 30
minor, 15 info; 35 NEW, 22 confirm existing register items.** All dispositioned **open**. Per-lane:
auth-session 11 · api-vs-access 5 · dashboard 6 · storage-files 9 · jobs 9 · templates-xss 7 · query-sql 3 ·
secrets-config 7. Adversarial re-run in §6.

### 5a. NEW majors — Step 3/4 fixes (highest value)
| ID | Finding | File:line | Fix class → step |
|---|---|---|---|
| SW-1 | **Progress IDOR** — `GET /course/:courseId/progress` guarded only by `courseMemberMiddleware` + a REQUIRED client `?profileId` passed straight to `getCourseProgress` with no self/staff check → any enrolled learner reads any classmate's per-unit completion/grades. The stock endpoint Phase 5 superseded with self-only `/learner-progress` but **left live**; contradicts ACCESS.md §9. | `apps/api/src/routes/course/course.ts:438` | add-guard (self-or-staff, or retire) → **Step 3** |
| SW-2 | **Course-clone authz hole** — `POST /course/:courseId/clone` `orgMemberMiddleware` only: (a) a STUDENT can clone + is added as ROLE.TUTOR to the new group; (b) source `getCourseById` has NO org filter → cross-org content read/copy; (c) destination `organizationId` from the request body → plant a course into an arbitrary org. | `apps/api/src/routes/course/course.ts:607` | add-guard (requireAdmin + org-bind source & dest) → **Step 3** |
| SW-3 | **Tutor PII leak via search** — `GET /organization/search` (`orgTeamMemberMiddleware`, TUTOR+) returns STUDENT name + email + avatar; `/team` + `/audience` were re-guarded to requireAdmin but search was missed, re-opening the Admin-only PII (ACCESS §1.3). | `apps/api/src/routes/organization/search.ts:12` | add-guard (requireAdmin, or strip PII) → **Step 3** |
| SW-4 | **login-link bypasses the deactivation gate** — mints a session via raw `db.insert(schema.session)`, skipping `databaseHooks.session.create.before` (DEACTIVATED) + admin ban-check. A deactivated/banned user with a valid ≤10-min login-link token gets a live session (mitigated: resolveActor/customSession re-read status). | `packages/db/src/auth/plugins/login-link.ts:77` | add-guard (route session-create through the gate) → **Step 3** |
| SW-5 | **Presign uploads unbounded** — `generateUploadPresignedUrl` sets no `Content-Length` condition and no bucket max-object-size; `assertWithinSize` is advisory on an OPTIONAL client `fileSize` (omit it → bypass); HLS batch presign has NO size check → storage exhaustion / cost DoS on every upload path. | `packages/core/src/utils/s3.ts:138` | storage-policy max-object-size + presign size condition → **Step 3** |
| SW-6 | **Document-presign key from unvalidated courseId** — `/course/presign` builds `materials/${courseId}/…` from a `courseId` validated only `z.string().min(1)` (not uuid, no ownership) under bare `requireActor()` → cross-course/arbitrary-key writes. | `apps/api/src/routes/course/presign.ts:139` | validate uuid + bind ownership → **Step 3** |
| SW-7 | **Material-download guard only checks `materials/` keys** — `assertCourseMaterialDownloadAccess` applies currency + unit-lock checks ONLY to keys starting `materials/`; any other key shape bypasses the lock/currency check. | `apps/api/src/middlewares/guards/ownership.ts:247` | default-deny non-materials keys → **Step 3** |
| SW-8 | **Email-template stored-XSS** — `newsfeed.ts` interpolates author fullname + course title + post/comment body raw into HTML; `student-course-welcome.ts` + `student-course-completion.ts` interpolate a teacher-supplied `customMessage` raw into the learner's email → stored XSS rendered in another user's inbox. | `packages/email/src/emails/newsfeed.ts:22`, `student-course-welcome.ts:27`, `student-course-completion.ts:29` | escape-output (HTML-escape all interpolated user/org text) → **Step 3** |
| SW-9 | **Raw-SQL interpolation (SQLi surface)** — `getEnrolledCourses` splices `sql.raw(\`'${profileId}'::uuid\`)` inside a correlated subquery; `getOrgStudentLoginsByDayOfWeek` splices `sql.raw(\`${days}\`)::int`. Both currently receive server-typed values, but `sql.raw` of any variable is the wrong pattern (breaks param binding). | `packages/db/src/queries/course/course.ts:991`, `queries/dash/dash.ts:153` | param-query (bind, drop sql.raw) → **Step 3** |
| SW-10 | **Exercise authoring is student-reachable** — `DELETE /course/:courseId/exercise/:exerciseId` uses `courseMemberMiddleware` (an enrolled STUDENT passes) with no team check; `POST …/exercise` human path is course-member too → a student can create/delete exercises. (Worse than the D5 premise.) | `apps/api/src/routes/course/exercise.ts:272,152` | add-guard (team/admin) → **Step 3**; confirms **D5** |
| SW-11 | **PII in logs** — the email processor logs the recipient address on every send; notification fan-out logs recipient emails on failure; the quiz-assigned idempotency key embeds the recipient email in the Redis keyspace. | `apps/jobs/src/processors/emails/send.ts:33`, `notifications/notify-course-exercise.ts:65,61` | redact/hash → **Step 6 (LOG-1)** |
| SW-12 | **PII persisted at rest with no retention** — on retry-exhaustion every worker writes `job.data` verbatim (emails/names) into `dead_letter_job`; the maintenance worker schedules no retention reap for it. | `apps/jobs/src/workers/emails.ts:57`, `workers/maintenance.ts:94` | redact payload + retention reap → **Step 6** |

### 5b. NEW minors / info — Step 3/4 or accept
| ID | Finding | File:line | → |
|---|---|---|---|
| SW-13 | No password policy (`minPasswordLength` unset → better-auth default 8). | `auth/email-password.ts:12` | config (set explicit 8+) → Step 3 |
| SW-14 | `admin()` plugin enabled config-less → exposes `/api/auth/admin/*` (create-user/set-role/ban/impersonate); relies on better-auth `user.role==='admin'` (which our org-role users lack) — **verify no non-admin reach**. | `auth.ts:169` | review/gate → Step 3 |
| SW-15 | AI-assistant chat `{@html renderMarkdown(text)}` — `marked.parse` without sanitise → XSS if AI/mention output injects (AI off by default). | `dashboard …/ai-assistant/message-bubble.svelte:166` | sanitise (DOMPurify) → Step 3 |
| SW-16 | Lesson version-history assigns stored content via raw `innerHTML`. | `dashboard …/lesson-version-history.svelte:152` | sanitise → Step 3 |
| SW-17 | Email branding `themeColor` interpolated raw inside a `<style>` block. | `email/src/templates/default.ts:92` | escape/validate → Step 3 |
| SW-18 | Upload type validation is by client MIME string only, not content/magic-byte sniffing. | `services/coursework/coursework.ts:31` | content-sniff or accept → Step 3 |
| SW-19 | No dedicated rate limiter on any presign/upload endpoint. | `routes/course/presign.ts:57` | rate-limit → Step 3; confirms **SA-4** |
| SW-20 | Presigned download URLs cached in Redis 50 min keyed only by `bucket:key` (shared across users). | `packages/core/src/config/storage.ts:54` | review lifetime/scope → Step 3 |
| SW-21 | Media/HLS job + asset mutations open to any org member incl. STUDENT. | `routes/jobs/jobs.ts:91`, `organization/assets.ts:125` | add-guard → Step 3; confirms **D10** |
| SW-22 | Orphaned BullMQ queues `course-imports`, `onboarding-bootstrap` (defaults defined, no worker/producer). | `packages/jobs/src/queues/names.ts:11,13` | remove/document → Step 4; with **D40** |
| SW-23 | Hardcoded ClassroomIO strings — newsfeed reply-to `noreply@classroomio.com` + `${org} - ClassroomIO` From-name (bypasses env sender); OG fallback vendor CDN image; widget default base `classroomio.com`. | `services/newsfeed/newsfeed.ts:488`, `services/org/og.ts:12`, `services/widget-payload.ts:21` | config/env → Step 3; with **D35** |
| SW-24 | Undocumented env vars used in code but absent from ENV.md — `AI_TUTOR_CAP_ENFORCED`, `FFMPEG_PATH`/`FFPROBE_PATH`, embed-script `CLOUDFLARE_API_TOKEN` (a secret). | `services/agent/tutor-usage.ts:28`, `jobs/utils/ffmpeg.ts:14`, `apps/embeds/scripts/upload-embeds.ts:54` | ENV.md + review → Step 3 |
| SW-25 | Progression `sql.raw(exerciseAlias)` splices a table alias — currently a typed literal union (safe), noted for the param-query sweep. | `queries/course/progression.ts:25` | verify/accept → Step 3 |

### 5c. Confirms of existing register items (reinforced with concrete file:line)
SW confirms: **SA-6/O1** session 30d no idle (`auth.ts:109`) · **SA-6/O2** reset+verify 1h fallback (`email-password.ts:12`)
· **D6/SA-6** 100-yr reusable link-invite (`invite.ts:469`) · **D8** token-exchange raw-session bypass
(`token-exchange.ts:86`) · **SA-3** wildcard `*.classroomio.com` trusted-origins (`constants.ts:12`, api
`constants/index.ts:9`) · **SA-2** `useSecureCookies`/sameSite (`auth.ts:96`) · **D29** split-env plugin gating
(`auth.ts:52`) · **D7** hooks cookie-presence gate + silent-empty-on-403 + slug-cookie
(`hooks.server.ts:83`, `org/[slug]/…`) · **D4** flat nanoid keys (`upload.ts:25`) · **D37** public media bucket
(`routes/media/media.ts:8`) · **D10** HLS/asset org-member scope · **D40** dead webhooks queue
(`queues/names.ts:10`) · **D30** ffmpeg failure path (`jobs/utils/ffmpeg.ts:55`).

### 5d. Step-3 fix log (updated per commit)

**Group 1 — access findings (committed):**
- **SW-1 progress IDOR** — ✅ FIXED. Composed predicate `canReadLearnerProgress` (self / Admin / Manager /
  allocated-Tutor) in `guards/ownership.ts`, guarding `GET /course/:courseId/progress`. Regression test
  `__tests__/authz/hardening-access.test.ts` (5). Live-verified: learner→another 403, own 200.
- **SW-2 course-clone** — ✅ FIXED. `requireAdmin` (was any org member) + source course bound to the actor's org
  (no cross-org copy) + destination org forced to the actor's own (was request-body). Live-verified: learner→403.
- **SW-3 search PII** — ✅ FIXED. `GET /organization/search` → `orgAdminMiddleware` (was `orgTeamMember`; it
  returns learner name+email — Admin-only per ACCESS §1.3). Live-verified: tutor→403.
- **SW-10 exercise authoring** (confirms D5) — ✅ FIXED. create / from-template / update / delete exercise →
  course-team (was course-member/student); learner submission + video routes unchanged. Live-verified: learner→403.

**Group 2 — email XSS (committed):**
- **SW-8 email-template stored-XSS** — ✅ FIXED. Applied the existing `escapeHtml` helper to every user/org sink
  in `newsfeed.ts` (author/title/post/comment), `student-course-welcome.ts` + `student-course-completion.ts`
  (teacher `customMessage`, student/org/course names). Regression test `tests/xss-escaping.test.ts` (4) — a
  `<script>` payload renders escaped, never raw.

_Remaining Step-3 groups (open): SW-4 login-link gate, SW-5/6/7 storage, SW-15/16/17 other XSS, SW-9/25 raw-SQL,
SA-1/1b headers+CSP, SA-2 cookies, SA-3 CSRF origins, SA-4/D14 rate-limits, SA-6/O1/O2/D6 session+tokens, D29
split-env, SW-13 password policy, SW-14 admin-plugin review, SW-18-24 minors/config._

## 6. Adversarial re-run (Phases 1–7 authz + adversarial suites)

`pnpm vitest run` (apps/api) — **448 passed, ZERO regressions.** All 21 authz/adversarial test files pass:
guard-layer, ownership-predicates, route-wiring, allocation-access, caseload-access/routes, coursework-access/
routes, materials-access, enrolment-content-access, unlock-enforcement, progress-self, authoring-admin-only, and
every phase's `*-authz` (announcements, messaging, notification-centre, onboarding, reports, registrations,
id-verification, preferences). The only failures are the **6 pre-existing BASELINE load-failures (D1)** — retired
in Step 7. No new regression to register.
