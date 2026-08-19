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
