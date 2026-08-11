# CODEMAP — LMSclassroom (Phase 0 orientation)

Fork of ClassroomIO at `upstream-baseline` = `9adc38bd8ae8de002d2963f0a892edeb5840dc87` (see [FORK.md](FORK.md)).
Produced by a three-agent sweep (apps/runtime, data/auth, integrations/egress) with spot-verification
against the code on 2026-08-11. Trust this over upstream READMEs where they disagree — drift is noted.

Monorepo: pnpm workspace + Turbo 1.x. Package manager pinned `pnpm@10.19.0`; Node `^20.19.3`
(`.nvmrc` v20.19.3). `pnpm-workspace.yaml` globs `apps/*`, `packages/*`, `packages/course-app/src/*`,
and sets `minimumReleaseAge: 1440` (24h supply-chain cooldown on new npm publishes).

## 1. Apps

| Path | Name | Purpose |
|---|---|---|
| `apps/api` | `@cio/api` | Hono backend (Node via `@hono/node-server`); also exports the typed RPC client |
| `apps/dashboard` | `@cio/dashboard` | Main SvelteKit admin/learner app (the product) |
| `apps/jobs` | `@cio/jobs-worker` | BullMQ workers: media, media-transcribe, emails, notifications, maintenance, agent-course-generation |
| `apps/website` | `@cio/website` | Vendor marketing site (SvelteKit → Cloudflare). Not deployed by us |
| `apps/docs` | `@cio/docs` | Vendor docs site (blume/Astro; needs Node ≥22.12 — conflicts with repo Node 20). Not deployed by us |
| `apps/embeds` | `@cio/embeds` | Embeddable widgets (course widget, question-type picker) |
| `apps/course-app` | `@cio/course-app` | Standalone course-site SvelteKit app (live twin of the scaffold template) |
| `apps/tenant-router` | `@cio/tenant-router` | Cloudflare Worker for the vendor's multi-tenant cloud (subdomain routing, `/proxy` split, R2 HLS). Not deployed by us |

## 2. Packages

| Path | Name | Purpose |
|---|---|---|
| `packages/core` | `@cio/core` | Shared env config (`@cio/core/config/env` — the API-side zod schema), storage client, Redis utils, agent services |
| `packages/db` | `@cio/db` | Drizzle schema, Better Auth instance (`@cio/db/auth`), migrations + setup/seed scripts |
| `packages/jobs` | `@cio/jobs` | BullMQ queue registry, enqueue helpers, Redis connection factory |
| `packages/email` | `@cio/email` | Email templates + send (nodemailer SMTP or ZeptoMail) |
| `packages/question-types` | `@cio/question-types` | Shared question-type models |
| `packages/ui` | `@cio/ui` | Svelte component library (Tailwind compile to `src/output.css`) |
| `packages/utils` | `@cio/utils` | Shared utils/constants (incl. `ROLE` ids) |
| `packages/analytics` | `@cio/analytics` | In-product analytics ingestion/rollup (our data, internal) |
| `packages/certificates` | `@cio/certificates` | Certificate rendering |
| `packages/ai-assistant` | `@cio/ai-assistant` | AI assistant/provider layer |
| `packages/mcp` | `@classroomio/mcp` | Published MCP server for course authoring (forwards to API) |
| `packages/storybook` | `@cio/storybook` | Storybook for ui/certificates/email |
| `packages/course-app` | `@classroomio/course-app` | CLI scaffolding a course site from `src/template` (itself a workspace member) |
| `packages/tsconfig` | `@cio/tsconfig` | Shared tsconfigs |

## 3. Running locally (per DEV_SETUP_NOTES.md — do NOT use root `pnpm dev`)

Two terminals: `pnpm api:dev` (API + jobs) and `pnpm dashboard:dev` (dashboard + ui watch).
Shared packages must be built once first (`pnpm build`) — apps import from `dist/`.
Env files are **per app** (`apps/api/.env`, `apps/dashboard/.env`, `apps/jobs/.env`, `packages/db/.env`) — see [ENV.md](ENV.md).

| Service | Port | Start |
|---|---|---|
| API (Hono/Node) | **3002** (`env.PORT`, default in `apps/api/src/constants/index.ts:5`) | `tsx watch src/index.ts`; prod `node dist/index.js` |
| Dashboard (SvelteKit) | **5173** | `vite dev --port 5173`; prod `node build/index.js` (adapter-node; adapter-cloudflare only when `CI_ENVIRONMENT=cloudflare`) |
| Jobs worker | none (no HTTP) | `apps/jobs/src/index.ts` imports all six workers; prod can scale per-worker via `start:<worker>` |
| Postgres | 5432 | docker `postgres:16-alpine` (we replace with Supabase) |
| Redis | 6379 | docker `redis:7-alpine` |
| MinIO | 9000/9001 | docker, behind compose profile `minio` (we replace with Supabase Storage) |

Docker: `docker-compose.yaml` (build from source: postgres, redis, minio+minio-init [profile], api:3081,
dashboard:3082, jobs) and `docker-compose.images.yaml` (same topology from Docker Hub images).
`PRIVATE_SERVER_KEY` and `BETTER_AUTH_SECRET` use `:?` so the stack refuses to start unset.
`docker/entrypoint-api.sh` runs `db:setup` on every api container start (idempotent, skip with `SKIP_DB_SETUP=true`).
**No mailpit/mailhog service exists upstream — we add Mailpit ourselves for local SMTP.**
`apps/course-app` dev has no port flag → defaults to 5173 and collides with the dashboard if both run.

## 4. Request lifecycle (dashboard → API → DB)

1. **Typed Hono RPC client** — `apps/api/src/rpc-types.ts` exports `hcWithType = hc<typeof app>`;
   consumed at `apps/dashboard/src/lib/utils/services/api/index.ts:6`. The dashboard aliases
   `@cio/api` → its built `dist/`, so **the API must be built before the dashboard type-checks**.
2. **Base URL** — `getRequestBaseUrl()` (`.../services/api/index.ts:14-33`): SSR uses
   `PRIVATE_SERVER_URL || PUBLIC_SERVER_URL`; browser-dev goes direct to `PUBLIC_SERVER_URL`
   (http://localhost:3002); browser-prod uses `${origin}/proxy` so auth cookies stay first-party.
3. **The `/proxy` hop** — `apps/dashboard/src/hooks.server.ts:39-42` → `shouldForwardToApi` →
   `proxyRequestToApi` (`apps/dashboard/src/lib/utils/proxy-api-request.ts:16-31`): matches `/proxy/*`
   (prefix stripped) and `/api/auth/*` (passed through) and forwards to `PRIVATE_SERVER_URL`.
   (In the vendor cloud, `apps/tenant-router` does this split at the CF edge instead — not our path.)
4. **API entry/router** — entry `apps/api/src/index.ts` (`serve({port: API_PORT})`, connects Redis,
   preloads verified custom-domain origins); router `apps/api/src/app.ts`. Middleware order: logger →
   prettyJSON → secureHeaders → CORS → Better Auth session hydration into ctx (`user`, `session`,
   `orgRoles`) → rateLimiter. Auth catch-all `.on(['POST','GET'], '/api/auth/*')` → `auth.handler`
   (from `@cio/db/auth`) at `app.ts:169`. Routers mounted: onboarding, account, course, domain, hls,
   transcripts, mail, media, jobs, license, organization (+sso, token-auth), dash, community, invite,
   org-site, public-api/v1, cohort, unsplash, widgets, internal, agent. OpenAPI + Scalar at `/docs`.
   Queue dashboard mounts at `/admin/queues` AFTER the typed chain (`app.ts:269`) so it doesn't
   pollute the RPC client type.
5. **DB** — Drizzle over node-postgres; client at `packages/db/src/drizzle.ts` (cached on `globalThis`
   outside production; pool max `DATABASE_POOL_MAX`, default 10).
6. **Async** — producers call `@cio/jobs` enqueue helpers (`packages/jobs/src/enqueue/*.ts`) → BullMQ
   on Redis → `apps/jobs` workers consume.

## 5. Schema + migrations

- **One schema file**: `packages/db/src/schema.ts` (~3.8k lines; enums from :27, `user` :74,
  `session` :111, `profile` :392, `organizationmember` :1816, `role` :1999, `organization` :2035).
  Relations in `packages/db/src/relations.ts`.
- **Config**: `packages/db/drizzle.config.ts` — schema `./src/schema.ts`, out `./src/migrations`,
  dialect postgresql, url from `DATABASE_URL`.
- **Migrations**: `packages/db/src/migrations/` — `0000_…` → `0005_…` + `meta/_journal.json`.
- **Workflow**: edit schema → `pnpm --filter @cio/db db:generate` (creates migration; commit it) →
  apply via `db:migrate` or the full `db:setup`.
- **`db:setup`** (`packages/db/src/scripts/db-setup.ts`) is the real apply path: creates
  `authenticated`/`anon` PG roles (used by RLS policies) → advisory lock `4242424242` →
  `baselineMigrationsIfNeeded` (adopts pre-existing DBs into drizzle's journal by hashing each
  migration, `src/scripts/baseline.ts:51`) → `drizzle-kit migrate` → seeds reference data
  (roles/submissions/question-types); `--seed` adds demo data.
- **Doc drift**: `packages/db/README.md` still describes a `db pull`/`db push` loop and claims
  `db:setup` runs `drizzle-kit push` — **wrong; the code runs committed migrations** (`migrate`).
  `PREVIEW_ENV.md:52-54` is the accurate description.

## 6. Auth (Better Auth)

- **Server config**: `packages/db/src/auth.ts` — `betterAuth` from `better-auth/minimal`,
  `drizzleAdapter(db, {provider:'pg'})`. Providers: email+password (bcrypt cost 10,
  `packages/db/src/auth/email-password.ts`), Google OAuth (env-gated), per-org SSO/OIDC.
  Plugins: `admin()`, `anonymous()`, `sso()`, conditional `oAuthProxy()` (skipped when self-hosted),
  custom `loginLink()` + `tokenExchange()` (`packages/db/src/auth/plugins/`), `customSession()`.
- **Session model**: cookie-based, DB-backed (`session` table, `schema.ts:111-128`). 30-day expiry,
  1-day updateAge, 1h cookie cache, cookie prefix `classroomio`, host-only cookies.
- **BaseURL**: `packages/db/src/constants.ts:36-37` — self-hosted uses `DASHBOARD_ORIGIN`.
- **Hooks** (`auth.ts:97-126`): `user.create.after` → `createProfileHook`
  (`packages/db/src/auth/hooks/create-profile.ts` — creates `profile`; auto-verifies the FIRST
  self-hosted signup's email); `user.update.after` → profile sync; session hooks → login tracking.
- **Email verification**: `packages/db/src/auth/email-verification.ts` — only sends when the URL
  carries `trigger=app` (dashboard owns the trigger; Better Auth's automatic send is suppressed).
  Password reset: `packages/db/src/auth/email-password.ts:36-68`. Both send via `@cio/email`.
- **Dashboard client**: `apps/dashboard/src/lib/utils/services/auth/client.ts`
  (`better-auth/svelte`; self-hosted baseURL = `<origin>/api/auth`); SSR client in `auth/server.ts`;
  session read in `auth/session.ts`.
- **RBAC**: integer role IDs in the `role` table — `ADMIN:1, TUTOR:2, STUDENT:3`
  (`packages/utils/src/constants/roles.ts`); membership in `organizationmember.roleId`.
  Roles ride the session via `customSession` → `getUserOrgRolesMap` → `{[orgId]: roleId}` (no
  per-request DB query; refreshes with the 1h cookie cache). Org-scoped middlewares read the
  `cio-org-id` header: `apps/api/src/middlewares/org-member.ts` (403 UNAUTHORIZED),
  `org-team-member.ts` (ADMIN|TUTOR), `org-admin.ts` (ADMIN), `license.ts`
  (FEATURE_REQUIRES_LICENSE, skipped when not self-hosted), `signup-guard.ts` (org signup rules).

## 7. Storage read/write paths

- **Clients** (`@aws-sdk/client-s3`, two mirrored sites): `packages/core/src/config/storage.ts:97`
  (API) and `apps/jobs/src/config/storage.ts:79` (worker). Separate presign client on the
  browser-reachable `OBJECT_STORAGE_PUBLIC_ENDPOINT` (`core/src/config/storage.ts:119-122`).
- **Preference order**: `OBJECT_STORAGE_*` (MinIO/S3-compatible — this is the path Supabase Storage's
  S3-compatible API will use) → Cloudflare R2 fallback (`CLOUDFLARE_*`) → **throws** if neither.
- **Ops**: `packages/core/src/utils/s3.ts` — `uploadToS3`, `getFromS3`, `deleteFromS3`, presigned
  download URLs (Redis-cached 50 min). Browser PUTs directly to presigned URLs
  (`apps/dashboard/src/lib/utils/services/courses/presign.ts:75`).
- **Buckets**: `videos`, `documents`, `media` (media is public-read in the stock minio-init).

## 8. Background jobs

Nine queues declared (`packages/jobs/src/queues/names.ts:5-15`); Redis connection factory in
`packages/jobs/src/connection.ts` (**`REDIS_URL` required, no default — throws if unset**).

| Queue | Worker | Egress |
|---|---|---|
| `media` | `apps/jobs/src/workers/media.ts` | none (ffmpeg + S3 + DB) |
| `media-transcribe` | `workers/media-transcribe.ts` | OpenAI Whisper (if key set) |
| `emails` | `workers/emails.ts` | SMTP / ZeptoMail |
| `notifications` | `workers/notifications.ts` | SMTP (reminder emails) |
| `maintenance` | `workers/maintenance.ts` | none |
| `agent-course-generation` | `workers/agent-course-generation.ts` | LLM providers (if keys set) |
| `webhooks` | **none — dead** (declared, no worker, no producer) | — |
| `course-imports` | **none — dead** | — |
| `onboarding-bootstrap` | **none — dead** | — |

Three repeatable schedulers, all internal (Redis/Postgres only): media-job reap (5 min) and
analytics daily rollup (24h) in `workers/maintenance.ts:88-110`; session-reminder scan (15 min)
in `workers/notifications.ts:43-54`.

Known bug (documented in DEV_SETUP_NOTES.md §6): `ffmpegProbeLuma` imported by
`apps/jobs/src/processors/media/generate-thumbnail.ts` but not exported from
`apps/jobs/src/utils/ffmpeg.ts` — crashes the two media workers. ffmpeg/ffprobe must be on PATH.

## 9. Tests

vitest (api, email, question-types, course-app, template), jest (dashboard — polar webhook tests
only), playwright (course-app template e2e). No `test` task in `turbo.json`; run per package
(`pnpm --filter @cio/api test`, etc.). CI builds only — **no workflow runs tests**.
Orphans: `packages/jobs/src/connection.regression.test.ts` (no runner wired), `cypress.yml`
workflow (no cypress directory exists).

## 10. Outbound endpoints — full egress table

Verdicts: **patch** = remove/neutralise in Step 4; **keep** = env-gated, off by default, harmless
unless we opt in; **review** = decide in Step 4.

| Host / endpoint | Purpose | Where | Trigger | Gate | Verdict |
|---|---|---|---|---|---|
| `enterprise-api.classroomio.dev` | License verify (`POST {licenseKey}` only — no usage/user data) | `apps/api/src/services/license.ts:28-38` | **On-demand, 1h in-memory cache — there is NO cron/scheduled phone-home** (verified: no interval/BullMQ/startup caller exists) | selfhosted=true; fires even with empty `LICENSE_KEY` | **patch** |
| `eu.i.posthog.com` via first-party `/ingest` | Product analytics; sends **email + name** (`setPersonProperties`), autocapture, named events | init `apps/dashboard/src/lib/utils/services/posthog/index.ts:40-54` (hardcoded key); events in login/signup/course files | App init + events | **flawed**: license path (`appSetup.ts:29-37`) only checks paid `no-tracking` feature — selfhosted alone does NOT disable | **patch** |
| `app.posthog.com` | Analytics (marketing site) | `apps/website/src/lib/utils/posthog/index.ts:3-6` (same hardcoded key) | SSR redirect routes | none | **patch** |
| `eu.i.posthog.com` | Analytics (course-app) | `apps/course-app/src/routes/+layout.svelte:12-13` (own hardcoded key) | onMount | none | **patch** |
| `umami.hz.oncws.com` | Vendor-hosted page analytics | `apps/dashboard/src/lib/utils/services/umami/index.ts:4,11`; `apps/website/src/app.html:64-69` | App init / page load | same flawed license gate (dashboard); none (website) | **patch** |
| `cdn.userjot.com` | Feedback widget (sends id/email/name/avatar) | `apps/dashboard/src/lib/utils/services/userjot/index.ts:6,34,72-78` | App init | correctly disabled when selfhosted | **patch** (belt-and-braces) |
| `widget.senja.io` | Testimonials widget | `packages/utils/src/senja/index.ts:4`; used by dashboard senja-embed | Component mount | license `no-tracking` | **patch** |
| `api.tinybird.co` | AI-agent observability (fire-and-forget) | `packages/core/src/utils/tinybird.ts:7,16` | Agent events | `TINYBIRD_TOKEN` unset = skipped | keep (verify unset) |
| `o476906.ingest.us.sentry.io` / any Sentry DSN | Errors + session replay (replay-on-error sample rate defaults to **1**) | `apps/api/src/instrument.ts`; `apps/dashboard/src/hooks.client.ts` | On error | `SENTRY_DSN`/`PUBLIC_SENTRY_DSN` unset = off; also skipped when selfhosted | keep |
| `api.openai.com` (Whisper) | Transcription | `apps/jobs/src/services/transcription/openai.ts:45-47` | media-transcribe job | `OPENAI_API_KEY` | keep |
| OpenAI/Anthropic/Google/Moonshot | AI assistant + course gen | `packages/ai-assistant/src/providers/index.ts:31-43` | Chat/agent | per-provider keys | keep |
| `r.jina.ai` | Agent URL→markdown | `packages/core/src/services/agent/fetch-url.ts:9` | Agent doc-fetch tool | agent feature use (SSRF-guarded) | keep |
| `api.unsplash.com` | Cover-image search | `apps/api/src/routes/unsplash/unsplash.ts:22` + 2 more | User search | `UNSPLASH_API_KEY` | keep |
| `api.cloudflare.com` browser-rendering | Certificate PDF/PNG | `apps/api/src/utils/cloudflare.ts:13,48` | Cert generation | CF account+key | keep (certs are out of scope for us anyway) |
| `api.polar.sh` | Billing (vendor SaaS) | `apps/dashboard/src/routes/api/polar/*` | User billing action | `POLAR_*` unset = dead | keep (moot: selfhosted = ENTERPRISE plan) |
| `accounts.google.com` (+ gsi/apis for Picker) | Google OAuth / Drive picker | `packages/db/src/auth.ts:58-64`; `google-drive-picker.ts` | Sign-in / picker | `GOOGLE_*` keys | keep |
| `buy.stripe.com` | Static payment link | `apps/course-app/src/lib/components/buy-template/buy-template.svelte:8` | User click | none | keep (course-app; not our deploy) |
| `api.github.com` | Star count | `apps/website/src/lib/server/github-stars.ts` | Website SSR | none | keep (website; not our deploy) |
| `cdn.tailwindcss.com` | Runtime Tailwind in generated cert/course/lesson HTML | `apps/api/src/utils/course.ts:17`, `utils/lesson.ts:16`, `apps/api/static/*.html:12` | Cert/export render | none | **review** |
| `api.dicebear.com` / `ui-avatars.com` | Generated/fallback avatars | `course-list-row-utils.ts:16`; `packages/ui/.../course-instructor.svelte:16` | Render | none | **review** |
| `muse.ai/embed` | Video player embed | `packages/ui/.../muse-player.svelte:13` (+dashboard twin) | Muse-video lessons | only if muse video used | keep |
| `images.unsplash.com` | Question-type picker imagery (real UI, not just fixtures) | `packages/ui/src/custom/question-type-picker/picker-data.ts:24-40` | Render | none | **review** |
| `fonts.googleapis.com`/`gstatic` | Web fonts | `apps/website/src/app.html:9-26` | Page load | none | keep (website only) |
| `r.wdfl.co` (Rewardful), `app.cal.com` | Affiliate / booking widgets | `apps/course-app/src/app.html:52`; `apps/website/src/app.html:100` | Page load | none | keep (not our deploys) |
| `google-translate113.p.rapidapi.com` | i18n dev script | `apps/dashboard/scripts/translate.cjs:110` | Manual script | RapidAPI key | keep |
| `api.cloudflare.com` purge / OpenAPI upload | Vendor deploy scripts | `apps/api/scripts/upload-openapi-spec.ts:47`; `apps/embeds/scripts/upload-embeds.ts:72` | Manual/CI | CF creds | keep |
| tenant-router `/ingest` proxy → `eu.i.posthog.com` | Edge PostHog forwarder | `apps/tenant-router/src/index.ts:60-61,307-312` | Cloud edge only | not our deploy | **patch** (defence in depth) |

Negative findings: no scheduled phone-home; no WebSocket/EventSource clients; no got/ky/https.request
(only fetch + 3 axios presign-upload sites); `apps/docs` has zero analytics; no Zoom integration.

**Egress-audit note for Step 4's exit check:** blocking `posthog.com` at the network edge is NOT
sufficient — dashboard PostHog ships through the first-party `/ingest` path. The init sites
themselves must be removed/disabled.

## 11. Known constraints — accepted for now

1. **One-org 403 (recorded, deliberately NOT patched in Phase 0).**
   `apps/api/src/services/onboarding.ts:28-33`: when `PUBLIC_IS_SELFHOSTED === 'true'`,
   `createOrganizationWithOwner` counts ALL organizations (`getOrganizationCount()` —
   `packages/db/src/queries/organization/organization.ts:1000-1004`, a bare instance-wide
   `SELECT count(*)`) and throws `AppError('Self-hosted instances support only one organization',
   VALIDATION_ERROR, 403)` if any exists. Both creation routes (`POST /onboarding/create-org`,
   `POST /organization`) funnel through this single function. Companion behaviour: the sole org
   gets an auto-created ENTERPRISE plan (`onboarding.ts:64-77`); the first signup's email is
   auto-verified (`packages/db/src/auth/hooks/create-profile.ts:15-19`); org-less users are
   auto-enrolled into the first org as STUDENT (`apps/api/src/services/account/profile.ts:53-68`);
   the org-switcher UI is hidden (`org-switcher.svelte:22,51`).
2. **Split-env gotcha**: `PUBLIC_IS_SELFHOSTED` must be set identically in BOTH `apps/api/.env` and
   `apps/dashboard/.env` (and is BUILD-TIME for the dashboard bundle). Upstream's own AGENTS.md:667
   records the failure mode: API behaves as cloud while the UI renders self-hosted. Read at process
   start — restart dev servers after changing it.
3. **Analytics gating flaw** (to fix in Step 4): `setupAnalyticsBasedOnLicense`
   (`apps/dashboard/src/lib/utils/functions/appSetup.ts:29-37`) enables PostHog+Umami unless the
   instance holds a paid `no-tracking` license — the self-hosted flag alone does not opt out.
4. **Media worker crash**: `ffmpegProbeLuma` missing export (see §8).
5. **`apps/docs` needs Node ≥22.12** while the repo pins Node 20 — docs site won't build in our
   toolchain (we don't deploy it).
