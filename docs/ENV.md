# ENV — environment surface (Phase 0 inventory)

Every env var the codebase reads, grouped by service, with its stock default and where the value
comes from **on our infra** (Supabase Postgres + Supabase Storage, Redis, SMTP; DigitalOcean in prod;
Mailpit locally). 🔒 = secret (never in git). Sources verified against the zod schemas
(`packages/core/src/config/env.ts`, `apps/jobs/src/config/env.ts`) and the `.env.example` files on
2026-08-11.

Env files are **per app** — there is no single root `.env` for local dev:
`apps/api/.env`, `apps/dashboard/.env`, `apps/jobs/.env`, `packages/db/.env` (root `.env` feeds
docker-compose interpolation only). Compose does not use `env_file:`; values interpolate from the
shell/root `.env`, and `BETTER_AUTH_SECRET` / `PRIVATE_SERVER_KEY` use `${VAR:?}` so the stack
refuses to start without them.

## 1. Core flags (read by API + dashboard + db)

| Var | Purpose | Stock default | Ours | 🔒 |
|---|---|---|---|---|
| `PUBLIC_IS_SELFHOSTED` | Master self-hosted switch (see §8) | `true` (root), `false` (dashboard example) | `true` everywhere. **Must match in API and dashboard env; build-time for the dashboard bundle** | |
| `NODE_ENV` | Runtime mode | `development` | per environment | |
| `DASHBOARD_ORIGIN` | Dashboard origin — auth baseURL (self-hosted), CSRF, email links | `http://localhost:3082` (docker) | local: `http://localhost:5173`; DO: our app URL | |
| `PUBLIC_SERVER_URL` | Direct API origin (browser-dev calls, SSR fallback) | `http://localhost:3081` (docker) | local: `http://localhost:3002`; DO: internal/api URL | |
| `PRIVATE_SERVER_URL` | SSR/proxy → API URL (internal network) | `http://api:3081` (docker) | local: `http://localhost:3002`; DO: internal service URL | |
| `PRIVATE_SERVER_KEY` | Dashboard↔API shared auth key (must match in both) | blank (script auto-generates) | generated once per env | 🔒 |
| `TRUSTED_ORIGINS` | Extra allowed origins for direct browser→API calls | empty | usually empty (proxy is same-origin) | |
| `PORT` | API listen port | 3002 (`apps/api/src/constants/index.ts:5`) | 3002 local; DO-assigned in prod | |

## 2. Database (Supabase Postgres for us)

Two connection strings, by design (Step 5). **Runtime** services use the Supabase
**transaction pooler (port 6543)** — the postgres-js client sets `prepare:false`
(the pooler runs in transaction mode, no prepared statements) and `ssl:'require'`.
**Migrations / DDL / admin scripts** use the **direct / session connection (port
5432)** — the transaction pooler can't run advisory locks, DDL, or drizzle-kit
migrate. Both come from the same Supabase project; only the port (and pooler vs
direct host) differ.

| Var | Purpose | Where read | Ours | 🔒 |
|---|---|---|---|---|
| `DATABASE_URL` | **Pooled** runtime conn string (6543) | `packages/db/src/drizzle.ts` (shared client → api, jobs, seed) | Supabase **transaction pooler** URL, port 6543 | 🔒 |
| `DIRECT_DATABASE_URL` | **Direct** conn string (5432) for migrations/DDL | `drizzle.config.ts`, `scripts/db-setup.ts`, `baseline.ts`, `db-reset.ts` (via `scripts/db-connection.ts`) | Supabase **direct or session pooler** URL, port 5432 | 🔒 |
| `DATABASE_SSL` | SSL escape hatch — default is SSL **required** | drizzle.ts + admin scripts | unset (SSL on); `disable` only for a plain local PG | |
| `PRIVATE_DATABASE_URL` | Legacy fallback read after DATABASE_URL | drizzle.ts, jobs, scripts | unused by us | 🔒 |
| `DATABASE_POOL_MAX` | postgres-js pool size | drizzle.ts | tune vs Supabase pooler client limit | |
| `POSTGRES_DB/USER/PASSWORD` | docker-compose local Postgres container only | compose | **unused** — the local Postgres container is retired (Supabase is external); see the flag comment atop `docker-compose.yaml` | 🔒 |

**Which Supabase value goes where.** From the project's *Connect* dialog, copy:
the **Transaction pooler** URI (`...pooler.supabase.com:6543`) → `DATABASE_URL`; the
**Direct connection** URI (`db.<ref>.supabase.co:5432`) or, on an IPv4-only network,
the **Session pooler** URI (`...pooler.supabase.com:5432`) → `DIRECT_DATABASE_URL`.
The DB password is embedded in those URIs. Set both in `apps/api/.env`;
`apps/jobs/.env` needs only `DATABASE_URL`; `packages/db/.env` needs
`DIRECT_DATABASE_URL`. **Local now, DigitalOcean later:** on DO set the same two
vars (plus `DATABASE_SSL` left unset) as service env — nothing else changes; the
image entrypoint's `db:setup` will migrate over `DIRECT_DATABASE_URL`.

## 3. Auth

| Var | Purpose | Stock default | Ours | 🔒 |
|---|---|---|---|---|
| `BETTER_AUTH_SECRET` | Session signing secret (stack refuses to start unset) | blank | generated per env | 🔒 |
| `AUTH_COOKIE_DOMAIN` | Cookie domain override (`apps/api/.env.example:9`) | blank | unset (host-only cookies) | |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth login (social login disabled when absent) | blank | unset for now | 🔒 |
| `LICENSE_KEY` | Enterprise license (SSO, token-auth, no-tracking) — sent to enterprise-api.classroomio.dev | blank | unset; the license call itself gets patched in Step 4 | 🔒 |

## 4. Storage (Supabase Storage S3-compatible for us)

Read by `packages/core/src/config/storage.ts` (API) and `apps/jobs/src/config/storage.ts` (worker).
Preference: `OBJECT_STORAGE_*` → Cloudflare R2 fallback → throw.

| Var | Purpose | Stock default | Ours | 🔒 |
|---|---|---|---|---|
| `OBJECT_STORAGE_ENDPOINT` | S3 endpoint (server-side) | `http://minio:9000` | Supabase Storage S3 endpoint (`https://<ref>.storage.supabase.co/storage/v1/s3`) | |
| `OBJECT_STORAGE_PUBLIC_ENDPOINT` | Browser-reachable endpoint for presigned URLs | `http://localhost:9000` | same Supabase S3 endpoint (public) | |
| `OBJECT_STORAGE_ACCESS_KEY_ID` / `OBJECT_STORAGE_SECRET_ACCESS_KEY` | S3 creds | minioadmin | Supabase S3 access keys (project settings → Storage → S3) | 🔒 |
| `OBJECT_STORAGE_REGION` | S3 region | unset | Supabase project region | |
| `OBJECT_STORAGE_FORCE_PATH_STYLE` | Path-style addressing | `true` | `true` (Supabase S3 is path-style) | |
| `OBJECT_STORAGE_BUCKET_VIDEOS/DOCUMENTS/MEDIA` | Bucket names | videos/documents/media | same names, created in Supabase | |
| `OBJECT_STORAGE_MEDIA_PUBLIC_BASE_URL` | Public base for media bucket | `http://localhost:9000/media` | Supabase public bucket URL | |
| `MINIO_ROOT_USER/PASSWORD` | MinIO container only | minioadmin | unused (no MinIO) | 🔒 |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ACCESS_KEY`, `CLOUDFLARE_SECRET_ACCESS_KEY`, `CLOUDFLARE_BUCKET_DOMAIN`, `CLOUDFLARE_IMAGE_BUCKET_DOMAIN`, `CLOUDFLARE_BUCKET_ID` | R2 fallback storage | unset | unused | 🔒 |
| `CLOUDFLARE_RENDERING_API_KEY` | CF browser-rendering (certificate PDFs) | unset | unused (certificates out of scope) | 🔒 |
| `HLS_SIGNING_SECRET` | Signs `cio_hls` playback cookie (pairs with tenant-router) | blank | unset (HLS disabled when self-hosted anyway) | 🔒 |

## 5. Redis + jobs

| Var | Purpose | Stock default | Ours | 🔒 |
|---|---|---|---|---|
| `REDIS_URL` | BullMQ + cache. **Required by the worker (throws if unset); no default anywhere** | `redis://redis:6379` (docker) | local: `redis://localhost:6379`; DO: managed/droplet Redis | 🔒 |
| `MEDIA_WORKER_CONCURRENCY`, `TRANSCRIBE_WORKER_CONCURRENCY`, `EMAIL_WORKER_CONCURRENCY`, `AGENT_COURSE_GENERATION_WORKER_CONCURRENCY` | Per-worker tuning | unset | defaults fine | |
| `QUEUE_DASHBOARD_PASSWORD` | Basic-auth for `/admin/queues` (core schema) | unset → dashboard hidden in prod | set if we want the queue UI | 🔒 |
| `QUEUE_DASHBOARD_ADMIN_EMAILS` / `QUEUE_DASHBOARD_TOKEN` | Alternative queue-dashboard access (api example) | unset | optional | 🔒 |

## 6. Email (SMTP; Mailpit locally)

Chosen at runtime: `ZOHO_TOKEN` set → ZeptoMail, else nodemailer SMTP (`packages/email/src/send.ts:132`).
API sends auth-flow emails itself; everything else goes through the jobs worker — both need the vars.

| Var | Purpose | Stock default | Ours | 🔒 |
|---|---|---|---|---|
| `SMTP_HOST` / `SMTP_PORT` | SMTP server (465 = implicit TLS, else STARTTLS enforced unless `SMTP_ALLOW_INSECURE`) | blank | local: Mailpit (**`127.0.0.1:1025`** — not `localhost`, which resolves to IPv6 `::1`); prod: real SMTP | |
| `SMTP_USER` / `SMTP_PASSWORD` | SMTP auth (optional when `SMTP_ALLOW_INSECURE=true`) | blank | empty for Mailpit; per provider in prod | 🔒 |
| `SMTP_SENDER` | From address | blank | our sender | |
| `SMTP_ALLOW_INSECURE` | **Dev only.** `true` lets nodemailer use an unauthenticated, non-TLS catcher (Mailpit): auth optional, `requireTLS` dropped. Unset = stock behaviour, zero prod impact. Added on the fork (Step 3). | unset | `true` in local api+jobs; **unset on DigitalOcean** | |
| `ZOHO_TOKEN` | ZeptoMail switch — **leave unset or SMTP is ignored** | unset | unset | 🔒 |

## 7. Optional integrations (all off-by-default; keep unset unless we opt in)

| Var | Purpose | 🔒 |
|---|---|---|
| `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`, `MOONSHOT_API_KEY` | AI assistant / course-gen / Whisper transcription | 🔒 |
| `UNSPLASH_API_KEY` | Cover-image search | 🔒 |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` (API) / `PUBLIC_SENTRY_DSN`, `PUBLIC_SENTRY_ENVIRONMENT`, `PUBLIC_SENTRY_TRACES_SAMPLE_RATE`, `PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE`, `PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE` (dashboard) | Error tracking. NB: replay-on-error sample rate defaults to 1 — full session replay if a DSN is ever set | 🔒 |
| `TINYBIRD_TOKEN`, `TINYBIRD_BASE_URL` | AI-agent observability (skipped when unset) | 🔒 |
| `JINA_API_KEY`, `AGENT_MAX_FETCHES_PER_CONVERSATION` (def 15), `AGENT_MAX_FETCHES_PER_ORG_PER_DAY` (def 500) | Agent URL-reader limits | 🔒 |
| `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_TOKEN_PACK_PRODUCT_ID`, `POLAR_SERVER` | Vendor billing (moot: self-hosted auto-gets ENTERPRISE plan) | 🔒 |
| `PUBLIC_GOOGLE_PICKER_CLIENT_ID` / `PUBLIC_GOOGLE_PICKER_API_KEY` | Drive video picker | 🔒 |
| `APPROXIMATED_*` (API_KEY, TARGET_ADDRESS, DNS_TARGET_IP, DNS_TARGET_CNAME) | Vendor custom-domain edge (cloud only) | 🔒 |
| `PROJECT_ID_VERCEL` / `TEAM_ID_VERCEL` | Legacy vendor domain mgmt | 🔒 |
| `SSO_ENCRYPTION_KEY` | Future SAML SSO | 🔒 |
| `OPENAPI_URL`, `PUBLIC_API_OPENAPI_URL` | OpenAPI spec publishing/fetch (vendor docs) | |
| `PUBLIC_EMBED_BASE_URL` | Embeds base URL | |

## 8. Dashboard-only (SvelteKit `$env`)

| Var | Purpose | Ours |
|---|---|---|
| `PRIVATE_APP_HOST` / `PRIVATE_APP_SUBDOMAINS` | Tenant domain routing (cloud); self-hosted skips subdomain resolution | stock (`localhost`/`app`) — irrelevant when self-hosted |
| `PUBLIC_APP_TITLE`, `PUBLIC_APP_DESCRIPTION`, `PUBLIC_OG_IMAGE_URL` | Custom branding meta tags | set to Pearl branding later |
| `PUBLIC_MEDIA_CDN_URL` | Public CDN base for media/OG | unset |
| `ALLOWED_EXTERNAL_DOMAINS`, `CSP_SCRIPT_SRC_DOMAINS`, `CSP_STYLE_SRC_DOMAINS`, `CSP_CONNECT_SRC_DOMAINS`, `CSP_FRAME_SRC_DOMAINS`, `CSP_FONT_SRC_DOMAINS`, `CSP_MEDIA_SRC_DOMAINS`, `CSP_FRAME_ANCESTORS_DOMAINS` | Runtime CSP allowlists (self-hosted starts from `'self'` only — `csp-domains.js:63-73`) | add Supabase Storage host so media loads |
| `UPLOAD_MAX_{DOCUMENT,IMAGE,VIDEO,EXERCISE_FILE,AGENT_DOCUMENT,LANDING_IMAGE,THUMBNAIL}_MB` | Upload caps (defaults 5/5/800/2/5/0.5/5) — set on BOTH api and dashboard | stock for now |
| `CI_ENVIRONMENT` | `cloudflare` switches the SvelteKit adapter | unset (adapter-node) |
| `CIO_VERSION` | docker-compose.images tag | unused (we build from source) |
| `SKIP_DB_SETUP` | Skips db:setup in the api container entrypoint | default false |

## 9. `PUBLIC_IS_SELFHOSTED` — where it's read and what it changes

Declared `packages/core/src/config/env.ts:48`. API/db read via `@cio/core/config/env` or
`process.env`; dashboard via `$env/static/public` (**inlined at build time**).

**API** (`apps/api/src/`): `services/onboarding.ts:28` (the one-org 403) and `:64` (auto-ENTERPRISE
plan); `middlewares/license.ts:15` (cloud skips license checks); `middlewares/signup-guard.ts:46`
(org-context signup rules); `services/account/profile.ts:37,53` (license fetch; auto-enrol org-less
users as STUDENT); `services/license.ts:19` (the enterprise-api call only fires when selfhosted);
`services/course/completion.ts:276` (certificates always enabled); `services/organization/student-limit.ts:63`
(exempt from plan caps); `services/organization/automation-usage.ts:64`; `services/org/og.ts:14`;
`instrument.ts:11` (Sentry skip).

**Dashboard** (`apps/dashboard/src/`): `lib/features/app/layout-setup.ts:26` (single org via
`getFirstOrg`, skips ALL subdomain/custom-domain tenant resolution); `init.svelte.ts:396,427`
(onboarding redirect + LMS routing); `lib/utils/store/org.ts:102,115,159,165,175` (origins;
`isEnterprisePlan` always true; API access); `store/app.ts:29` (student experience by role);
`services/auth/client.ts:29` (auth baseURL = `<origin>/api/auth`); `features/license/api/license.svelte.ts:20`;
`org-switcher.svelte:22,51` (hides org switching/creation UI); `lms-navigation.ts:71` (certificates
nav); `functions/appSetup.ts:24` (cloud-analytics path skip); `services/sentry/index.ts:5` +
`hooks.client.ts:7` (Sentry off); `services/userjot/index.ts:12` (UserJot off);
`functions/metaTags.server.ts:8`; `routes/+layout.server.ts:37`;
`routes/(app)/org/[slug]/+layout.server.ts:17` and `+layout.svelte:38`;
`upload-video.svelte:37` (HLS disabled); `automation/pages/api.svelte:39` (copy);
`svelte.config.js:11-12` (build-time CSP domains).

**db package**: `packages/db/src/auth.ts:34` (skip oAuthProxy plugin); `constants.ts:3,37` (auth
baseURL from `DASHBOARD_ORIGIN`); `auth/hooks/create-profile.ts:16` (first-signup auto-verify).

**Gotcha (upstream AGENTS.md:667):** setting it only in the dashboard env leaves the API in cloud
mode (second orgs allowed, no license gating) while the UI renders self-hosted. Set it in BOTH.
Read at process start — restart after changing. Dashboard value is baked into the built bundle.
