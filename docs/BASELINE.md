# BASELINE — stock ClassroomIO on Windows (Phase 0, Step 3)

Recorded 2026-08-11 on the `upstream-baseline` fork (`9adc38bd8`), before any
infrastructure changes. Purpose: prove the unmodified codebase runs end-to-end on
its own stock docker dependencies, so post-baseline failures are attributable to
our changes. Host: Windows 11, Node 20.19.3 (nvm), pnpm 10.19.0, Docker Desktop
29.6.2 (WSL2).

## Bring-up commands (all pass)

```bash
# 1. Toolchain
nvm use 20.19.3            # repo pins ^20.19.3 (.nvmrc); pnpm 10.x
pnpm install              # 2,623 packages

# 2. Per-app .env files (see docs/ENV.md); secrets generated with openssl rand -hex 32
#    apps/api/.env, apps/dashboard/.env, apps/jobs/.env, packages/db/.env
#    (also a root .env for docker-compose ${VAR:?} interpolation)

# 3. Stock docker dependencies (+ Mailpit, added this step — see below)
docker compose -f docker-compose.yaml --profile minio up -d \
  postgres redis mailpit minio minio-init

# 4. Build shared packages, then migrate + seed
pnpm build                                   # Turbo, all packages
pnpm --filter @cio/db db:setup               # migrations + essential seed

# 5. Run (two terminals)
pnpm api:dev          # API :3002 + BullMQ workers
pnpm dashboard:dev    # dashboard :5173
```

Container status at baseline: `cio-postgres` (healthy), `cio-redis` (healthy),
`cio-minio` + `cio-minio-init` (buckets videos/documents/media created),
`cio-mailpit` (SMTP :1025, web UI :8025).

## Manual walkthrough — PASS end-to-end on stock infra

| Step | Result | Evidence |
|---|---|---|
| Sign up (`owner@pearl-lms.test`) | ✅ | `POST /api/auth/sign-up/email` 200; first self-hosted signup auto-verifies email (stock behaviour — no verification email sent) |
| Create org "Pearl Test Org" (`pearltest`) | ✅ | `POST /onboarding/create-org` **201** — first org allowed (the one-org 403 only trips on the 2nd org) |
| Onboarding metadata | ✅ | `POST /onboarding/update-metadata` 200 → redirect to `/org/pearltest` |
| Create course "Baseline Test Course" | ✅ | course id `4bc6ee25-…`; visible in course list |
| Create section + lesson | ✅ | "Module 1" → "Lesson 1 - Baseline" |
| Upload file attachment (PDF, Docs tab) | ✅ | `POST /course/presign/document/upload` 200 → browser PUT to MinIO 200; object on disk at `/data/documents/…-baseline-upload-test.pdf` |
| Retrieve the file | ✅ | `POST /course/presign/document/download` 200 → presigned GET from MinIO **200** |
| Auth email flows to Mailpit | ✅ | password-reset email captured in Mailpit ("Password reset notification - ClassroomIO" → owner@pearl-lms.test) after the fixes below |

## Test suite baseline

No CI runs tests; suites are per-package. Results as run on this checkout:

| Package | Runner | Result |
|---|---|---|
| `@cio/api` | vitest | **72 tests pass**; 6 of 11 test *files* fail to load (pre-existing — see F1) |
| `@cio/email` | vitest | **10 pass** / 10 |
| `@cio/question-types` | vitest | **33 pass** / 33 |
| `@cio/course-app` | vitest | **1 pass** / 1 |
| `@cio/dashboard` | jest | **0 run** — config fails to parse (pre-existing — see F2) |
| `courseapp` (template) | vitest | runs in watch mode (no `--run`), does not terminate in CI-style invocation (pre-existing script shape) |

**Total: 116 tests passing**, 0 test *assertions* failing. All non-green results
are pre-existing harness/config issues, not assertion failures — documented below,
not fixed (per Step 3 instruction to record, not fix, pre-existing failures).

### Pre-existing failures (NOT introduced by our changes)

- **F1 — `@cio/api` 6 test files fail to load** with
  `Failed to load url @cio/core/services/… (Does the file exist?)` for subpaths
  like `@cio/core/services/course/go-live-readiness`,
  `@cio/core/services/agent/question-update`, `@cio/db/queries/notifications`.
  The target files **exist** in `dist/` and the full `pnpm build` is green; this
  is a vite/vitest resolver quirk with `@cio/core`'s wildcard subpath exports
  (`"./services/*"`). Independent of our work — our only build-side change (F4)
  made `@cio/core` build at all, which is what lets the other 72 api tests run.
- **F2 — `@cio/dashboard` jest suite cannot start**:
  `jest.config.ts(10,1): TS1295 … verbatimModuleSyntax` — ts-node cannot compile
  the TS jest config under the repo's TS settings. Zero tests execute. Pre-existing
  toolchain mismatch.
- **F3 — the stock `test` script for `@cio/api` is `vitest NODE_ENV=test`**, which
  passes `NODE_ENV=test` to vitest as a positional **filter**, so `pnpm --filter
  @cio/api test` reports "No test files found, exiting with code 1". Running vitest
  with `NODE_ENV` as an actual env var yields the 72-pass result above. Pre-existing
  script defect.

## Windows / local-dev fixes applied this step (minimal, documented)

- **F4 — `packages/core/scripts/restore-bare-specifiers.mjs` (Windows path bug).**
  The script used `new URL('../dist/', import.meta.url).pathname`, which on Windows
  yields `/C:/Users/…` and made `fs` resolve `C:\C:\Users\…` → `@cio/core:build`
  failed, cascading to api/dashboard. **Fix:** use `fileURLToPath(...)` instead of
  `.pathname`. *Impact:* build-only, cross-platform-safe (fileURLToPath is correct
  on POSIX too); unblocks the entire build. This is the single change that makes
  the stock codebase build on Windows.
- **F5 — Mailpit added + stock email path taught to reach an auth-less catcher.**
  Upstream compose ships **no** mail catcher and the nodemailer transport
  (`packages/email/src/utils/services/nodemailer.ts`) hard-requires
  `SMTP_USER`+`SMTP_PASSWORD` and forces `requireTLS` on any non-465 port — so it
  cannot talk to a local Mailpit (no auth, no TLS). Changes:
  - Added a `mailpit` service to `docker-compose.yaml` (SMTP :1025, UI :8025).
  - Added an **opt-in** `SMTP_ALLOW_INSECURE` env flag (`packages/email/src/config/env.ts`).
    When `'true'`: auth creds become optional and `requireTLS` is dropped. **When
    unset (production default) the code path is byte-for-byte unchanged** — no real
    SMTP provider is affected.
  - Set `SMTP_ALLOW_INSECURE=true` in `apps/api/.env` + `apps/jobs/.env` for local dev.
- **F6 — `SMTP_HOST=127.0.0.1`, not `localhost`.** Node 18+ resolves `localhost`
  to IPv6 `::1` first, but Mailpit binds `127.0.0.1:1025` → `ECONNREFUSED ::1:1025`.
  Using the IPv4 literal fixes it. Local-dev env only.
- **F7 — `scripts/format-changed.mjs` pre-commit hook broken on Windows.** It ran
  `spawnSync('prettier', …)` without `shell: true`; Windows can't launch prettier's
  `.CMD` shim that way, so the script silently exited 1 and **every commit failed
  the lefthook pre-commit hook** (lefthook's generic "Prettier formatting check
  failed" text masked the real cause — prettier never actually ran). **Fix:** add
  `shell: true` to that spawn. POSIX behaviour unchanged. This is required to commit
  at all on Windows.

## Notes / known-benign at baseline

- `apps/docs` warns `Unsupported engine: wanted node >=22.12` (repo pins Node 20).
  We don't build/deploy the docs site; harmless.
- Media/thumbnail workers log `ffmpeg-binaries-missing` and the known
  `ffmpegProbeLuma` export bug (DEV_SETUP_NOTES §6). Only the two media workers are
  affected; API/dashboard/emails/maintenance are fine. Not exercised by the walkthrough.
- Redis "Connection timeout (reconnecting)" lines appear once at worker startup then
  settle to "ready" — cosmetic reconnect noise, all workers report ready.

## Egress audit (Phase 0, Step 4 — after the privacy patches)

Ran 2026-08-11 after removing PostHog + umami telemetry and the
`enterprise-api.classroomio.dev` phone-home. Goal: prove no telemetry/usage data
leaves our infrastructure. Result: **PASS — zero traffic to any swept domain.**

Swept domains: `*.posthog.com`, `eu.i.posthog.com`, `app.posthog.com`,
`umami.hz.oncws.com`, `enterprise-api.classroomio.dev`.

**Method 1 — server-side runtime probe (API + jobs).** Attached a temporary
outbound-request probe *outside the repo* (a `--import` preload via `NODE_OPTIONS`
subscribing to undici's `undici:request:create` diagnostics channel + a global
`fetch` wrapper), logging every outbound origin+path. It attached to all 24 tsx
worker processes. Started the full stack, signed in as a real user, and exercised
the endpoints that used to trigger the phone-home — `GET /account`,
`GET /license/features`, `GET /session` (all 200) plus workspace/org/course calls.
**Result:** the probe log recorded ZERO outbound HTTP requests during the exercise
(only the "probe attached" markers), and zero hits for any swept domain. The probe
and its logs live only in the scratch dir and were removed afterward — nothing in
the repo or its runtime config references them.

**Method 2 — built client-bundle scan (dashboard).** The Playwright browser
network tab was unavailable this session, so instead of proving "no request fired
once," we proved the stronger "the code isn't shipped at all": grepped the compiled
browser bundle (`apps/dashboard/build/client` + `.svelte-kit/output/client`,
executable `.js` only). **Result:** 0 occurrences of `posthog.com`, `i.posthog`,
`posthog.init`, `posthog.capture`, `hz.oncws.com`, or any posthog-js library code.
The only `posthog`/`umami` strings remaining are in `.js.map` source maps — the
retained no-op function names + the removal comments. (One `rrweb` hit in the app
entry is Sentry's session-replay canvas patch — `__rrweb_original__` — not posthog;
Sentry stays off unless a DSN is set.)

**Method 3 — phone-home unit test.** `apps/api/src/__tests__/no-phone-home.test.ts`
spies on global `fetch`, calls `getLicenseStatus()` / `isFeatureLicensed()` /
`isFeatureLicensedSync()`, and asserts fetch is never called and all features are
licensed. Passes. This locks in "the phone-home cannot fire" (removed outright, not
flag-gated).

**Method 4 — repo-wide source grep.** `posthog|umami|enterprise-api.classroomio.dev|
hz.oncws.com` across `apps/**` + `packages/**` (excl. node_modules/dist/build). Every
remaining hit is inert: no-op function-name imports (kept for the smallest safe diff),
removal comments, or the course-app scaffolding CLI's demo template that is literally
*named* "posthog" (`packages/course-app/templates.json`, marketing content — not
analytics). No live init, host, or fetch remains.

**Residual egress NOT in this step's scope (documented, dead for our self-hosted
config; recommended follow-ups):** UserJot (`cdn.userjot.com`, PII-capable) is
hard-disabled when `PUBLIC_IS_SELFHOSTED=true`; Senja (`widget.senja.io`) is gated on
the `no-tracking` feature, now always licensed → off; Tinybird needs an unset
`TINYBIRD_TOKEN`; Sentry needs an unset `SENTRY_DSN`/`PUBLIC_SENTRY_DSN`. **Recommend
a follow-up to hard-remove UserJot** (it transmits id/email/name/avatar and is only
env-flag-gated, not removed outright).

## Privacy patch summary (Step 4 changes)

- Dashboard `posthog` + `umami` service modules → inert no-ops (no client ever
  constructed); analytics init stripped from `appSetup.ts`; `posthog.reset()` and the
  direct `posthog-js` import removed from `logout.ts`; posthog/umami hosts removed from
  the CSP allowlist (`csp-domains.js`).
- API `license.ts` → `fetchLicenseFromApi` (the sole `enterprise-api.classroomio.dev`
  caller) **deleted**; `getLicenseStatus` returns all features locally with no network
  call (we own this hard fork — no external license server).
- Non-deployed apps cleaned so the grep is truly clean: course-app layout posthog init
  removed; website `posthog-node` client → inert stub + umami `<script>` removed from
  `app.html`; tenant-router `/ingest` → PostHog proxy route removed.
- Dependencies removed: `posthog-js` (dashboard, course-app), `posthog-node` (website).
- Packaging fix: added the missing `./license` subpath export to `@cio/utils`
  `package.json` (imported by 5 source files but undeclared — only resolved under tsx,
  not Node/vitest). Makes the regression test loadable; strict correctness improvement.

## Step 5 — Supabase Postgres repoint (verification)

Ran 2026-08-11. The DB moved off the local Postgres container onto Supabase project
**LMSCLASSROOM** (`cvtmymxxjgjshrzsjxnj`, eu-west-1, PG17). Runtime → transaction
pooler (6543, `prepare:false` + SSL); migrations → session pooler (5432, SSL). The
true direct host (`db.<ref>.supabase.co`) is IPv6-only and unreachable from this
IPv4 machine, so the **session pooler on 5432** is used as `DIRECT_DATABASE_URL` (it's
session-mode, so advisory locks / DDL / drizzle-kit migrate all work). Pooler host
prefix for this project is `aws-1-eu-west-1` (not `aws-0`) — verified empirically.

- **Migrations:** `pnpm --filter @cio/db db:setup` applied cleanly over the direct
  connection; **101 public tables** created, including Better Auth's `user`, `session`,
  `account`, `verification`. Essential seed (3 roles, 3 submission statuses, 14 question
  types) inserted over the **pooled** runtime client — confirming `prepare:false`+SSL work.
- **Walkthrough (via API + Supabase MCP, Playwright MCP was down):** fresh signup
  (`founder@lmsclassroom.test`) → user+account+session+profile written to Supabase,
  `email_verified=true` (self-hosted first-signup auto-verify) → fresh sign-in (2nd
  session row) → create org (ENTERPRISE plan auto-provisioned) → create course → section
  → lesson. Final Supabase counts: users 1, sessions 2, orgs 1, courses 1, lessons 1.
- **Tests:** `@cio/api` vitest **mocks the DB** (`vi.mock` on `@cio/db` queries) — it makes
  no real connection, so it neither needs nor hardwires a test DB and is unaffected by the
  repoint. 74 pass / same 6 pre-existing F1 load failures — no regression.
- **Local Postgres container:** retired. `docker-compose.yaml` carries a prominent comment
  marking `postgres` unused (kept only because api/jobs `depends_on` it for the image deploy
  graph, rewritten in the DO step). Local bring-up now omits `postgres` from the `up` list.

## Step 6 — Supabase Storage repoint (verification)

Ran 2026-08-11. Object storage moved off MinIO onto **Supabase Storage** (same project
`cvtmymxxjgjshrzsjxnj`). The storage client is a generic `@aws-sdk/client-s3`, so this was
**pure configuration — no code/adapter change**; only env + bucket creation + docs.

- **Buckets** created in Supabase, mirroring the stock layout: `documents` (**private**),
  `videos` (**private**), `media` (**public-read**). Coursework `.docx` + lesson attachments
  live in the private `documents` bucket, served via presigned URLs. `media` stays public-read
  for images/avatars/thumbnails (served via `OBJECT_STORAGE_MEDIA_PUBLIC_BASE_URL`) — matches
  stock (MinIO also made only `media` public) and avoids a signed-URL refactor of image serving.
- **Config:** endpoint `https://<ref>.storage.supabase.co/storage/v1/s3`, region `eu-west-1`,
  `OBJECT_STORAGE_FORCE_PATH_STYLE=true`, Supabase S3 access keys. API logs
  `[storage] Using S3-compatible object storage`.
- **Walkthrough (through the app):** login → `POST /course/presign/document/upload` issued a
  Supabase presigned PUT → uploaded a `.docx` → object confirmed in the Supabase `documents`
  bucket (67 B, correct MIME, via Supabase MCP) → `POST /course/presign/document/download`
  issued a presigned GET → **served back HTTP 200 with matching content** → the raw
  unauthenticated public URL returned **HTTP 400 (denied — bucket private)**. A direct S3
  roundtrip probe (PUT/presigned-GET/unauth-deny/DELETE) corroborated before the app test.
- **MinIO:** retired. `docker-compose.yaml` comment marks it unused; it was already behind the
  `minio` compose profile so it never starts by default. Local dev now brings up redis + mailpit
  only (DB and storage are both external Supabase).
- **Tests:** no storage tests exist in the suite; none hardwire storage. 74 pass / 6 pre-existing
  F1 load failures — no regression. No heavy mocks added (Phase 0 guidance).

## Step 7 — SMTP mail flows (verification)

Ran 2026-08-11. All three transactional mail paths verified against local Mailpit with
env-driven sender identity. **Code change:** `EMAIL_REPLY_TO` was hardcoded to
`help@classroomio.com`; now env-driven via a new `SMTP_REPLY_TO`
(`packages/email/src/utils/constants.ts` + `config/env.ts`). `SMTP_SENDER` (From) was
already env-driven. All email links already resolve via `DASHBOARD_ORIGIN` — no link fix
needed.

- **Verification** (2nd user + `send-verification-email` with a `trigger=app` callbackURL):
  From `"Pearl LMS" <noreply@pearl.local>`… actually `"LMSClassroom Test Org (via
  ClassroomIO.com)" <noreply@pearl.local>`, Reply-To `support@pearl.local`, link
  `http://localhost:5173/api/auth/verify-email?token=…`. ✓
- **Password reset** (`request-password-reset`): From `"Pearl LMS" <noreply@pearl.local>`,
  Reply-To `support@pearl.local`, link `http://localhost:5173/api/auth/reset-password/…`. ✓
- **Org invite** (`POST /organization/team/invite`, via jobs worker): From `… <noreply@pearl.local>`,
  Reply-To `support@pearl.local`, link `http://localhost:5173/invite/<token>`. ✓
- **Env-driven proof:** the From **address** (`noreply@pearl.local`) and **Reply-To**
  (`support@pearl.local`) on every message come from `SMTP_SENDER` / `SMTP_REPLY_TO`, not the
  ClassroomIO defaults.
- **Branding:** hardcoded ClassroomIO copy/logos/subjects recorded in `docs/TODO-BRANDING.md`
  (deferred; not functionally broken). The `(via ClassroomIO.com)` From display-name suffix is
  the most visible one.
- **Test:** `packages/email/tests/sender-identity.test.ts` asserts `EMAIL_FROM`/`EMAIL_REPLY_TO`
  follow `SMTP_SENDER`/`SMTP_REPLY_TO`. Email suite 12 pass (was 10).

## Egress re-audit (Phase 7 Step 5 — after the integrations register) — 2026-08-19

Re-ran the Phase-0 egress-audit method (same rigour) after the owner-signed disablements in
docs/INTEGRATIONS.md (Public API v1 + automation-key management gated self-hosted-off; the 4
`/api/polar/*` Polar commerce routes removed; UserJot neutered to no-ops). **Result: PASS —
the live egress set matches the register's keeps exactly; no surprise endpoints.**

Swept set = the Phase-0 domains extended with the key-gated hosts (`api.tinybird.co`,
`cdn.userjot.com`, `widget.senja.io`, `*.sentry.io`, `r.jina.ai`, `api.polar.sh`,
`api.openai.com`, `api.unsplash.com`, `api.cloudflare.com`, AI-provider hosts).

- **Method 1 — server-side runtime probe (API + jobs).** undici `request:create` diagnostics
  subscriber + global `fetch` wrapper via `NODE_OPTIONS --import`, while exercising the server
  paths (public registration → DB write + Manager/Admin notification enqueue; approval-queue read;
  course picker; learner ID-verification read). **ZERO outbound HTTP origins** logged. (Postgres +
  Redis + SMTP are raw TCP to our own infra, not undici HTTP.)
- **Method 2 — built client-bundle grep** (`.svelte-kit/output/client`, `.js` only, `.map`
  excluded). Only `widget.senja.io` present (Senja — kept, gated-off marketing widget). **`cdn.userjot.com`
  gone** (UserJot neutering confirmed); no posthog/umami/tinybird/sentry/polar/phone-home strings.
- **Method 3 — phone-home unit test** (`no-phone-home.test.ts`) — PASS.
- **Method 4 — repo-wide source grep.** Deployed apps (dashboard/api/jobs) all inert
  (comments / neutered no-ops / gated-off constants / plan-gated dead UI referencing the now-removed
  local `/api/polar/*` routes). Remaining live external-host strings only in **non-deployed** apps
  (`apps/website`, `apps/tenant-router`) + a dormant `@cio/db` Polar-subscription maintenance script.

**Live egress == register keeps:** Supabase Postgres + Storage, the SMTP mailer, and (learner-browser
only, if a staff member embeds one) an external media host. Everything else removed or inert-without-a-key;
Public API / automation / Polar disabled. Disabled-surface checks: `/public-api/v1` +
`/organization/automation` → 404 self-hosted (`blockWhenSelfHosted`, unit-tested); `/api/polar/*` routes
deleted; UserJot exports are no-op stubs.
