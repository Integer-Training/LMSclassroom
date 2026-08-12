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
  then starts. No new migrations are expected since Step 5 (baseline `0000…0005`); the
  baseline logic no-ops on the already-migrated Supabase DB.
- Caddy obtains a Let's Encrypt cert for `APP_DOMAIN` on first request (needs port 80/443
  reachable + DNS resolving).

```bash
docker compose -f docker-compose.deploy.yaml ps          # all healthy?
docker compose -f docker-compose.deploy.yaml logs -f api  # watch startup / migrations
```

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
| **Deployed commit** | `0bed259a9` (== `origin/main` HEAD at deploy). After any doc/code push, `git pull` on the droplet so its HEAD stays equal to `origin/main` — verify with `git rev-parse HEAD`. |
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
