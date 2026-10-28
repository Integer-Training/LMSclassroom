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
docker compose -f docker-compose.deploy.yaml up -d --build
```

- The **api entrypoint auto-runs `db:setup`** (migrations over `DIRECT_DATABASE_URL`),
  then starts. Pending migrations are applied in order (see the safety notes below); the
  baseline logic no-ops on the already-migrated Supabase DB.
- Caddy obtains a Let's Encrypt cert for `APP_DOMAIN` on first request (needs port 80/443
  reachable + DNS resolving).

```bash
docker compose -f docker-compose.deploy.yaml ps          # all healthy?
docker compose -f docker-compose.deploy.yaml logs -f api  # watch startup / migrations
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
docker compose -f docker-compose.deploy.yaml up -d --build
```

Rollback: `git checkout <previous-commit>` then re-run the `up -d --build`.

## 7. AGPL sync rule

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
