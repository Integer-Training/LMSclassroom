# RUNBOOK — PearlLMS operations

Operational procedures for the live service (`https://learn.epearlacademy.com`, DigitalOcean droplet + Docker
Compose + Caddy; data on Supabase project `cvtmymxxjgjshrzsjxnj`). Companion to [DEPLOY.md](DEPLOY.md) (first-time
setup) and [HARDENING-PLAN.md](HARDENING-PLAN.md) (security register).

**This runbook is what you operate from.** The maintenance cadence (§7) is the recurring commitment.

---

## 1. Health checks

| Check | How | Healthy looks like |
|---|---|---|
| **API liveness** | `GET https://learn.epearlacademy.com/proxy/health` (or api `:3002/health` on the droplet) | `200 {"status":"ok","service":"api",...}` |
| **Site up** | `GET https://learn.epearlacademy.com/login` | `200`, valid TLS, login renders |
| **Containers** | on droplet: `docker compose -f docker-compose.deploy.yaml ps` | all 5 (redis, api, jobs, dashboard, caddy) `healthy`/`Up` |
| **Migrations** | `docker compose -f docker-compose.deploy.yaml logs api \| grep -i migrat` | ran clean at last boot |

`/health` is an **unauthenticated liveness probe** (no DB/Redis call — a transient dependency blip must not page on
liveness). Readiness of Supabase/Redis is observed at their own dashboards. It returns no PII and no secrets.

## 2. Monitoring & alerts  *(owner sets up at the DO dashboard — O5)*

Per the Step-1 confirmed budget (free tier): a **DigitalOcean Uptime check** on `https://learn.epearlacademy.com`
+ the `/health` probe, alerting **to the owner's email**.

**Setup (owner, DO console → Monitoring → Uptime):**
1. Create an Uptime check → target `https://learn.epearlacademy.com/login` (HTTPS, expect 200), 1-min interval.
2. Add a check → `https://learn.epearlacademy.com/proxy/health`, expect body contains `"status":"ok"`.
3. Alert policy → notify `amandeep.behal@me.com` (+ `mokshith@integertraining.com`) on "check is down" and on
   "certificate expiring < 14 days".
4. **Fire-test once:** DO console → send test notification, OR on the droplet
   `docker compose -f docker-compose.deploy.yaml stop dashboard` for ~2 min → confirm the alert email arrives →
   `… start dashboard`. Record that the test alert was received (date + who witnessed).

## 3. Backups & storage durability  *(owner confirms at the Supabase dashboard — O4)*

Confirmed expectation (Step 1): **Supabase PITR** (Pro plan → 7-day point-in-time recovery) **plus a daily logical
backup with 30-day retention**. Storage objects rely on **Supabase Storage's own durability** (our buckets), with an
owner-approved periodic export only if the expectation requires more.

**Confirm/adjust (owner, Supabase dashboard → Database → Backups):**
- PITR enabled (needs Pro) — note the window; daily backups on, retention set to 30 days.
- Storage: buckets `documents`/`videos` (private) + `media` (public) exist; durability is Supabase-managed. If a
  periodic off-site export is wanted, the simplest honest version is a scheduled `supabase storage` object sync to
  a second bucket/provider — implement only if the owner asks.

## 4. Restore drill  *(scratch project — owner creates it; NEVER production)*

**Goal:** prove the backup is restorable, and time it. Restore **production → a scratch Supabase project**, verify a
checklist, then **delete the scratch project** and confirm deletion. No production writes; no restore-over-production.

**Procedure:**
1. **Owner** creates a throwaway Supabase project ("pearllms-restore-drill") and triggers a restore of the latest
   backup (or PITR to a chosen timestamp) **into that scratch project**. Note start/end time → **restore duration**.
2. Point a LOCAL app instance at the scratch DB: set `DIRECT_DATABASE_URL` / `DATABASE_URL` to the scratch
   connection strings in a local `.env`, then run the verification checklist below (reads only).
3. **Verification checklist** (scratch DB):
   - **Row counts** on key tables match production expectation (± backup lag): `profile`, `organizationmember`,
     `course`, `lesson`, `coursework_submission`, `coursework_result`, `tutor_allocation`, `user`, `session`,
     `account`, `audit_event`.
   - **One learner's journey intact** — pick a real learner id: their `organizationmember` row, `groupmember`
     enrolment(s), `coursework_submission` history, `coursework_result`(s), and completion state all present and
     internally consistent.
   - **Auth tables usable** — `user` + `account` (credential rows) + `session` present; a password-reset could be
     issued (Better Auth reads these).
   - **Storage sample** — restore/download a handful of `documents/` objects and open one through the
     locally-pointed app (presigned download) if practical.
4. **Time it** — record restore duration + checklist pass/fail.
5. **Delete the scratch project** (owner, Supabase dashboard) and **confirm it no longer lists**. Scratch held
   production data, so this deletion is mandatory and must be verified.
6. Record procedure, timings and evidence below.

**Drill record:**

| Date | Restore duration | Checklist result | Scratch project deleted (confirmed) | Witnessed by |
|---|---|---|---|---|
| _pending owner scratch project_ | | | | |

> Status: the drill **procedure is ready**; execution is owner-gated (requires an owner-created scratch Supabase
> project). Run it with the owner, then fill the row above. Re-run **quarterly** (see §7).

## 5. Deploy rollback

Deployed code is built from a commit on `origin/main` (DEPLOY.md invariant — no deploy-only patches). To roll back
to the previous known-good commit:

```bash
ssh root@<DROPLET_IP>              # ssh -i ~/.ssh/pearllms_deploy root@165.232.97.8
cd /opt/pearllms
git log --oneline -5               # find the previous known-good commit hash
git checkout <previous-good-hash>  # or: git reset --hard <hash>
docker compose -f docker-compose.deploy.yaml up -d --build   # rebuild from that commit
docker compose -f docker-compose.deploy.yaml ps              # confirm healthy
git rev-parse HEAD                 # RECORD the now-deployed commit
```

Then re-point `main` forward once the fix lands, and redeploy. **Migrations are forward-only** — a schema-changing
migration is not auto-reverted by a code rollback; if a bad migration is involved, restore via §4 to a pre-migration
point (coordinate with the owner). Prefer rolling **forward** with a fix for schema issues.

## 6. Incident basics

- **Who:** owner (Amandeep) is incident lead; Mokshith on comms. Escalate app/security issues here.
- **First moves:** (1) is it up? — §1 health checks. (2) Scope — one learner, one org, or everything? (3) Check
  `docker compose … logs -f api` / `… jobs` / `… dashboard` on the droplet.
- **Where logs live:** container stdout via `docker compose -f docker-compose.deploy.yaml logs [service]`. There is
  no external log aggregator (self-hosted, minimal). Logs are **PII-clean** (Step 6 sweep) — safe to read/share.
- **Correlation ids (Step 4):** every API error response carries `correlationId` (also the `x-correlation-id`
  response header); the full error is logged server-side keyed by that id. When a user reports "something went
  wrong (ref: …)", `docker compose … logs api | grep <correlationId>` finds the exact failure — no stack ever
  reached the user.
- **Data-exposure suspicion:** never expose one learner's data to another — if a report suggests cross-learner
  access, capture the correlation id, pull the log line, and check the relevant guard (`middlewares/guards/`).

## 7. Maintenance cadence  *(the recurring commitment — run from here)*

**Monthly:**
- `pnpm audit` across the workspace → triage new critical/high; patch smallest-first (Step-5 method), or add a
  documented exception to `FORK.md`. Refresh Docker base images (`docker/Dockerfile.*`) and rebuild.
- Watch upstream ClassroomIO for **security** advisories/commits (`git fetch upstream` →
  `git log upstream-baseline..upstream/main`); cherry-pick only security fixes, record in `FORK.md`.
- Confirm backups are running (Supabase dashboard) and the uptime monitor is green.
- Skim logs for anything unexpected; confirm no PII/secrets have crept into new log lines.

**Quarterly:**
- Perform the **restore drill** (§4) again — a backup you haven't restored is a belief, not a capability. Update
  the drill record.
- Review `HARDENING-PLAN.md` deferred items (e.g. the CSP `unsafe-eval` canary evidence, vitest/major dep bumps)
  and pick up any that have become low-risk.

**On every deploy:** confirm `git rev-parse HEAD` on the droplet == `origin/main`; run the smoke (login per role,
one upload, one marking, headers visible in dev tools, source link present).
