# DEPLOY — PearlLMS on DigitalOcean (Shape A: droplet + docker compose + Caddy)

Deploys dashboard + API + jobs + Redis on one droplet, fronted by Caddy for automatic
HTTPS. Database and object storage are **external Supabase** (Steps 5–6). The deployed
code is **built from source at `origin/main` HEAD**, so deployed == pushed (AGPL §13).

Artifacts: [`docker-compose.deploy.yaml`](../docker-compose.deploy.yaml),
[`docker/Caddyfile`](../docker/Caddyfile), [`.env.deploy.example`](../.env.deploy.example).

## 0. Prerequisites

- A DigitalOcean droplet — **Ubuntu 22.04/24.04, 2 vCPU / 4 GB** (Basic, ~$24/mo).
  4 GB is recommended: three Node apps + Redis + Caddy + an in-place source build.
- A **domain/subdomain** with a DNS **A record → the droplet's public IP** (e.g.
  `lms.yourdomain.com`). Caddy needs this resolvable to issue the TLS cert.
- **Real SMTP** credentials (any provider: Zoho ZeptoMail / AWS SES / Postmark / Resend).
- The Supabase **pooled + direct** connection strings and **S3 access keys** (same project
  as local — see the team vault, never the repo).

## 1. Droplet base setup (once)

```bash
ssh root@<DROPLET_IP>
apt-get update && apt-get install -y ca-certificates curl git
# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sh
docker compose version   # confirm v2
# Firewall: allow SSH + HTTP + HTTPS
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 2. Clone the repo at origin/main HEAD

```bash
git clone https://github.com/Integer-Training/LMSclassroom.git /opt/pearllms
cd /opt/pearllms
git checkout main && git pull
git rev-parse HEAD          # RECORD THIS — the deployed commit (must equal origin/main)
```

## 3. Configure secrets (droplet-side `.env` — never committed)

```bash
cp .env.deploy.example .env
# generate the two auth secrets
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)"  >> /tmp/secrets
echo "PRIVATE_SERVER_KEY=$(openssl rand -hex 32)"  >> /tmp/secrets
nano .env    # paste the two secrets; fill APP_DOMAIN/PUBLIC_APP_URL, Supabase URLs,
             # storage keys + CSP host, and the real SMTP values. Leave SMTP_ALLOW_INSECURE UNSET.
```

Key values (from `.env.deploy.example`): `APP_DOMAIN` + `PUBLIC_APP_URL`;
`DATABASE_URL` (Supabase **6543** pooler) and `DIRECT_DATABASE_URL` (Supabase **5432**
direct/session — migrations run over this); `OBJECT_STORAGE_*` (Supabase S3 endpoint +
keys, `MEDIA_PUBLIC_BASE_URL`); `CSP_CONNECT_SRC_DOMAINS` + `CSP_MEDIA_SRC_DOMAINS` =
the Supabase storage host (so browser uploads + media images aren't CSP-blocked);
SMTP host/port/user/pass/`SMTP_SENDER`/`SMTP_REPLY_TO`.

## 4. Deploy

```bash
COMPOSE_PARALLEL_LIMIT=1 docker compose -f docker-compose.deploy.yaml up -d --build
```

- The one-shot **`migrate` service** (the api image, `restart: 'no'`) runs `db:setup` (roles, migrations over
  `DIRECT_DATABASE_URL`, essential seed) and exits. `api` and `dashboard` `depends_on` it with
  `service_completed_successfully`, and the api runs with `SKIP_DB_SETUP=true`, so migrations run exactly once per deploy
  and a failing migration stops the rollout **before** a new api is started (the previous api container keeps serving; a
  crash-looping new api is no longer possible). Pending migrations are applied in order (see the safety notes below); the
  baseline logic no-ops on the already-migrated Supabase DB. Check it with `docker compose -f docker-compose.deploy.yaml logs migrate`;
  re-run by hand with `docker compose -f docker-compose.deploy.yaml run --rm migrate`.
- Migrations are **expand-then-contract only** from now on: the old api keeps running against the new schema while the new
  one starts, so a deploy must never drop or rename something the previous release still reads. Remove columns in a later
  release.
- Caddy obtains a Let's Encrypt cert for `APP_DOMAIN` on first request (needs port 80/443
  reachable + DNS resolving).

```bash
docker compose -f docker-compose.deploy.yaml ps          # all healthy?
docker compose -f docker-compose.deploy.yaml logs migrate  # migration output (one-shot service, exits 0)
docker compose -f docker-compose.deploy.yaml logs -f api  # watch startup
```

### Migration safety and index changes on large tables

- The migrator runs in-process (`packages/db/src/scripts/db-setup.ts`) with session `lock_timeout=5s` and
  `statement_timeout=60s`, so a migration blocked behind a long transaction fails fast and the container exits
  with a clear `canceling statement due to lock timeout` instead of queueing every reader behind it. The failed
  migration is rolled back; fix the cause (or wait for the blocker) and restart. Override for one run with
  `MIGRATION_LOCK_TIMEOUT` / `MIGRATION_STATEMENT_TIMEOUT` (e.g. `10min`) — never `ALTER ROLE ... SET`.
- While a table is small (Phase B indexes, 2026-10) a plain `CREATE INDEX IF NOT EXISTS` inside a drizzle
  migration is fine. `CREATE INDEX CONCURRENTLY` **errors inside a drizzle migration** (it runs in a
  transaction) — never put it there.
- **Once a table passes about 100k rows**, add indexes by hand first, then commit the migration:
  1. Connect through the **5432 session pooler / direct URL** (not the 6543 transaction pooler), with no wrapping
     transaction. Run **one statement per call**:
     ```sql
     SET lock_timeout = '5s';
     CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_name ON some_table (col);
     ```
  2. A failed or cancelled concurrent build leaves an INVALID index. Check and, if invalid, drop it and retry:
     ```sql
     SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indexrelid = 'idx_name'::regclass;
     DROP INDEX CONCURRENTLY IF EXISTS idx_name;
     ```
  3. Declare the index in `packages/db/src/schema.ts` with the **same name**, generate the migration with
     `drizzle-kit generate`, and edit it to `CREATE INDEX IF NOT EXISTS`. On deploy it is a no-op where the
     index already exists, and it builds normally on fresh databases.
  4. Confirm `drizzle-kit generate` then reports no diff.
- A new UNIQUE index (e.g. `uq_registration_pending_org_email`) fails to build if duplicates exist — check with a
  `GROUP BY ... HAVING count(*) > 1` first; removing duplicates is a data change that needs explicit approval.

## 5. Smoke test (on the live https URL)

1. Open `https://<APP_DOMAIN>` — the login page loads with a visible **"Source code
   (AGPL-3.0)"** link.
2. **Sign up** with a **real mailbox** → a verification email arrives via real SMTP →
   verify → **log in**.
3. Create a **course + lesson**; **upload** a file attachment and **retrieve** it (served
   back via a Supabase presigned URL).
4. Confirm a raw unauthenticated storage object URL is denied (private bucket).
5. **Telemetry check** — there must be **zero** attempts to posthog / umami /
   classroomio.dev:
   ```bash
   docker compose -f docker-compose.deploy.yaml logs | grep -iE "posthog|umami|classroomio\.dev" || echo "clean: no telemetry egress"
   ```

## 6. Update procedure (deployed == pushed)

```bash
cd /opt/pearllms
git pull                                   # fast-forward main
git rev-parse HEAD                          # new deployed commit (record it)
COMPOSE_PARALLEL_LIMIT=1 docker compose -f docker-compose.deploy.yaml up -d --build
```

Caddy retries the dashboard upstream for up to 30s (`lb_try_duration 30s`, `lb_try_interval 250ms`), so the few seconds
while the dashboard container restarts show visitors a short pause instead of a 502. The dashboard has a cheap TCP
healthcheck and Caddy waits for it on first start.

Rollback: `git checkout <previous-commit>` then re-run the `up -d --build`.

## 7. Capacity, build memory and monitoring (K1, K3, K4, K6)

### Build memory (K1)

A source build of three images is the heaviest thing the 4 GB droplet does. Build one image at a time:
`COMPOSE_PARALLEL_LIMIT=1 docker compose -f docker-compose.deploy.yaml up -d --build` (or export it in the deploy shell).
`docker/Dockerfile.dashboard` keeps its 8072 MB build heap: a trial `vite build` with `--max-old-space-size=3072` ran out of
memory, so do not lower it until the dashboard build itself gets lighter. Make sure the droplet has swap (`swapon --show`;
if empty add a 4 GB swapfile: `fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`
and an `/etc/fstab` line) and free old build layers now and then: `docker image prune -af --filter until=168h`
(weekly cron is fine; it never touches running containers).

### Memory limits (K4 starting points)

Limits are **starting points** to be revisited after about a week of `docker stats`. Each is overridable from `.env` (see
`.env.deploy.example`), so a limit that proves too tight is a one-line change and a `docker compose up -d`.

| Service | `mem_limit` | Node heap (`NODE_OPTIONS`) | Other |
|---|---|---|---|
| api | 768m (`API_MEM_LIMIT`) | `--max-old-space-size=576` (`API_NODE_OPTIONS`) | |
| dashboard | 768m (`DASHBOARD_MEM_LIMIT`) | `--max-old-space-size=576` (`DASHBOARD_NODE_OPTIONS`) | |
| jobs | 1200m (`JOBS_MEM_LIMIT`) | `--max-old-space-size=512` (`JOBS_NODE_OPTIONS`) | `cpus: 1.0`; the rest is headroom for ffmpeg/Whisper |
| redis | 512m (`REDIS_MEM_LIMIT`) | n/a | `--maxmemory 400mb --maxmemory-policy noeviction` (BullMQ needs noeviction; never use an LRU policy on this instance) |
| caddy | 128m (`CADDY_MEM_LIMIT`) | n/a | |

The limits total about 3.4 GB on a 4 GB droplet, which is deliberately tight for the OS and Docker daemon: this is the reason
to keep swap and to watch `docker stats` / DO memory alerts before and after the first week. An OOM-killed container shows up
as `OOMKilled: true` in `docker inspect` and as a restart; raise that one service's limit rather than removing limits.

### Database connection budget (K4)

postgres-js pools are per process. Pool sizes stay at the code default of **10** each; do not raise them before checking the
Supabase pooler `pool_size` (Supabase dashboard, Database, Connection pooling) and `max_connections`, because raising the app
pool only moves the queue rather than adding real concurrency.

| Consumer | Pool / connections | Variable | Via |
|---|---|---|---|
| api runtime | up to 10 | `DATABASE_POOL_MAX` | transaction pooler 6543 |
| jobs workers | up to 10 | `JOBS_DATABASE_POOL_MAX` (compose maps it to the jobs container's `DATABASE_POOL_MAX`) | transaction pooler 6543 |
| dashboard | 0 (talks to the api only) | n/a | n/a |
| migrate (a few seconds per deploy) | 2 to 3 (advisory-lock + migrator + setup client) | n/a | direct/session 5432 |
| **Steady total** | **20** | | |
| **During a deploy** | **20 + 3, plus the old api's pool while it drains (about 33 worst case)** | | |

Compare the steady total and the deploy peak with the pooler `pool_size`; if the peak is close to it, lower the two pool sizes
(for example 8 and 6) rather than raising the plan. A session-pooler 5432 connection (migrate) counts against a separate limit
from the 6543 transaction pool.

### Monitoring (K6)

- **Liveness:** `GET /proxy/health` (no dependencies). **Readiness, monitoring only:** `GET /proxy/ready` runs `select 1` and a
  Redis `PING` (2s each) and returns `503` with the failing dependency marked `fail`. Point the DO uptime check or alert at it.
  **Never** use `/ready` for a docker healthcheck, autoheal or a restart policy: a Supabase/Redis blip must alert a human, not
  restart a healthy api.
- **DO monitoring alerts** (owner, DO console): CPU above 80%, memory above 85%, disk above 80%.
- **Sentry is off by default.** It only starts when the DSN **and** the opt-in flag are both set: api `SENTRY_DSN` +
  `SENTRY_ENABLED=true`; browser `PUBLIC_SENTRY_DSN` + `PUBLIC_SENTRY_ENABLED=true` (also add the Sentry ingest host to
  `CSP_CONNECT_SRC_DOMAINS`). It sends no PII (`sendDefaultPii=false`), traces default to 5%, session replay stays off.
  Self-hosting no longer disables it by itself. Leave the variables unset to keep it disabled.

## 8. AGPL sync rule

The running app is built from source at the commit above. **`git rev-parse HEAD` on the
droplet MUST equal `origin/main` HEAD** on GitHub. Never apply deploy-only patches; land
every change on `main` first, then pull + rebuild.

---

## Deployment record

| | |
|---|---|
| **Environment** | Production |
| **URL** | https://learn.epearlacademy.com (Caddy + Let's Encrypt TLS) |
| **Droplet** | DigitalOcean `pearllms`, Ubuntu 24.04, 2 vCPU / 4 GB (lon1), `165.232.97.8` |
| **First deployed** | 2026-08-12 |
| **Deployed commit** | Kept **equal to `origin/main` HEAD** — the droplet is `git pull`ed after every push. Verify live: `ssh … 'cd /opt/pearllms && git rev-parse HEAD'` must equal `git rev-parse origin/main`. (A frozen hash is intentionally NOT recorded here — the commit that records a deploy always lands *after* it, so any literal hash would trail by one. Initial production deploy: 2026-08-12 from `0bed259a9`; kept in sync since.) |
| **DB / storage** | Supabase `cvtmymxxjgjshrzsjxnj` (Postgres pooled 6543 runtime / direct 5432 migrations; Storage documents+videos private, media public) |

**Smoke test (2026-08-12):** HTTPS 200 with valid cert; HTTP→HTTPS 308; "Source code
(AGPL-3.0)" link present; login + authed API through the `/proxy` path; course + section +
lesson created; document upload → Supabase → presigned download served back; raw
unauthenticated object URL denied (400, private bucket). Telemetry log audit across all
containers: **0** hits for posthog/umami/classroomio.dev. **Deferred until SMTP is
configured:** the email-dependent paths (fresh signup → verification, password reset,
invite) — SMTP is intentionally set up last; re-run those three once real SMTP is in `.env`.

**Deployed == pushed:** the running app is built from source at the commit above; keep the
droplet checkout equal to `origin/main` (pull + `up -d --build` on every change).
