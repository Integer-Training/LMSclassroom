# REPLICATION — standing up **Gecko Programmes** as a separate LMS from PearlLMS

> **What this is.** The end-to-end build spec to replicate this LMS (PearlLMS, live at
> `learn.epearlacademy.com`) as a **fully separate site** under the brand **Gecko Programmes**
> (working id `geckoprogrammes`) for a different training provider — **without** migrating any
> learners, tutors, submissions or course data.
>
> **Who it is for.** A developer or an AI coding agent (Claude CLI). Every step names files, env vars,
> commands and SQL checks. Phases are ordered; each ends with **Done when** acceptance checks — do not
> start a phase until the previous one passes.
>
> **Source of truth.** Written from the code at commit `0d1eed995` (2026-10-27) of
> `Integer-Training/LMSclassroom`. The appendices (A–E) are a route-by-route / table-by-table inventory
> produced by reading the code (not by clicking the live app) — where an appendix and the code disagree,
> **the code wins**; fix the appendix.

---

## 0. Decisions already made (by the owner, 2026-10-27)

| # | Decision |
|---|---|
| D1 | **Clone this codebase, rebrand, stand up separately** (not a rewrite). |
| D2 | **Fully separate infrastructure**: new Supabase project, new DigitalOcean droplet, new domain. Zero shared data with Pearl. |
| D3 | **New GitHub repo** `https://github.com/Integer-Training/newlmsgecko.git`, copied from this one, then **independent** (it drifts from Pearl; fixes are ported by hand/cherry-pick). |
| D4 | Brand name **Gecko Programmes**. **Domain, logo, sender email: TBD (owner will supply)** — use the placeholders below. **Colours: identical to Pearl.** |
| D5 | **Start empty** — no learners, tutors, courses. Course *content* may be copied from Pearl **later, on request** (Phase 11). |
| D6 | **Every feature, every screen, including the hidden ones** must exist and be wired exactly as in Pearl. |
| D7 | Connect to the **same Pearl CRM** — ⚠ see §3 "Open question Q1": no CRM↔LMS code exists today. |
| D8 | **New SMTP account + sender domain** for Gecko (own SPF/DKIM/DMARC). |
| D9 | Audience = developer / AI agent. |
| D10 | Secrets kept **locally** at `C:\Users\PC\Projects\_secrets\geckoprogrammes\` (outside every git repo). |

### Placeholders used throughout

| Placeholder | Meaning | Status |
|---|---|---|
| `{{BRAND}}` | `Gecko Programmes` | fixed |
| `{{SITE_NAME}}` | `geckoprogrammes` (org `site_name`; appears in URLs as `/org/geckoprogrammes/...`) | fixed |
| `{{GECKO_DOMAIN}}` | the brand's root domain | **TBD** |
| `{{APP_DOMAIN}}` | the LMS host, recommended `learn.{{GECKO_DOMAIN}}` | **TBD** |
| `{{SENDER_DOMAIN}}` | email sending domain, recommended `mail.{{GECKO_DOMAIN}}` | **TBD** |
| `{{SB_REF}}` / `{{SB_REGION}}` | new Supabase project ref / region | created in Phase 4 |
| `{{DROPLET_IP}}` | new droplet IPv4 | created in Phase 5 |
| `{{LOGO}}` | logo files (SVG + PNG 512², favicon set, OG image 1200×630) | **TBD** |

### Do we need the ClassroomIO repo? **No.**
`Integer-Training/LMSclassroom` is a complete hard fork: every app and package is in it, nothing is
fetched from ClassroomIO at build or run time. The `upstream` remote is kept only for optional security
cherry-picks (docs/FORK.md). The Gecko repo is created from **this** repo (Phase 1).

### Licence — AGPL-3.0 (mandatory compliance, not optional)
The code is ClassroomIO's under **AGPL-3.0**. Running a modified copy as a web service obliges you to
offer users the **exact running source**. Therefore: keep `newlmsgecko` **public**, keep `LICENSE` and
upstream notices, set `PUBLIC_SOURCE_REPO_URL`, keep the "Source code (AGPL-3.0)" link visible on the
login page, and make sure the droplet always runs a commit that is on `origin/main`. Full checklist:
Appendix E §6. **Never commit secrets** — the repo is public.

---

## 1. What you are replicating — system overview

### 1.1 Deployed components (prod "Shape A")
```
                 Internet ──443/80──► Caddy (TLS, Let's Encrypt)  {{APP_DOMAIN}}
                                         │  /proxy/* ──► api:3081   (Hono, apps/api)
                                         │  /*       ──► dashboard:3082 (SvelteKit, apps/dashboard)
   DigitalOcean droplet (Docker compose: docker-compose.deploy.yaml)
     ├─ caddy        ├─ dashboard   ├─ api (runs DB migrations + seed on boot)
     ├─ jobs (BullMQ workers: email, media, …)   └─ redis:7 (queues, rate limits; AOF volume)
                                         │
             ┌───────────────────────────┼───────────────────────────────┐
     Supabase Postgres (pooler :6543 runtime,   Supabase Storage (S3 API):   SMTP provider
     session :5432 migrations)                  documents(priv) videos(priv) media(public)
```
Only **dashboard, api, jobs, redis, caddy** are deployed. `apps/course-app`, `apps/website`,
`apps/embeds`, `apps/tenant-router`, `apps/docs` are **not** deployed and are not needed (Appendix C §G).
The app does **not** use supabase-js, Supabase Auth, Realtime or Edge Functions — auth is Better Auth
tables in the same Postgres; files go through the S3 API with presigned URLs.

### 1.2 Roles and where each one lives
| Role | groupmember / orgmember role | Lands on | Shell / nav |
|---|---|---|---|
| **Admin** (first admin = permanent **super admin**, derived = lowest admin member id) | role_id 1 | `/org/{{SITE_NAME}}/dash` | admin sidebar (`org-navigation.ts`) |
| **Manager** | MANAGER | `/reports` | **no sidebar** (bare page) — as built |
| **Tutor** | role_id 2 | `/caseload` | tutor sidebar (`features/caseload/components/tutor-sidebar.svelte`) |
| **Learner** | role_id 3 (STUDENT) | `/lms` | `lms-sidebar` |

- **Every `/org/[slug]/**` page is ADMIN-only** — enforced once in
  `apps/dashboard/src/routes/(app)/org/[slug]/+layout.server.ts` (`requireAdmin`). Deliberate.
- **Per-learner tutor model** (since `0d1eed995`): a tutor sees/marks **only learners individually
  allocated** to them (`tutor_allocation`; guard `isAllocatedTutor` in
  `apps/api/src/middlewares/guards/ownership.ts`). Being on a course's tutor team (`groupmember`
  role 2, `isCourseTutor`) grants **course-level** access only.
- Closed system: **no public self-signup**. Staff create accounts (temp password shown once,
  forced change on first login); the only public door is the registration form (`/register`) whose
  submissions an admin approves at `/registrations`.
- Full role × capability matrix: Appendix D §2.

### 1.3 Size of the thing
~120 dashboard pages, 431 API handlers in 74 routers, 119 tables / 27 enums / 27 migrations,
9 BullMQ queues (6 live, 3 dead), 3 repeatable schedulers, 29 email templates. API test baseline:
523+ passing (see Appendix D §7 for the documented baseline).

### 1.4 Feature flags (compile-time, `apps/dashboard/src/lib/utils/constants/features.ts`)
Many screens are **hidden by flags but present** — Gecko must ship them **identically** (D6), i.e. same
flag values as Pearl, and they must still work when reached by URL. Current production values (all
`false` unless noted): `ORG_HOME_ENABLED`, `COHORTS_ENABLED`, `TAGS_ENABLED`, `WIDGETS_ENABLED`,
`AI_ENABLED`, `API_ACCESS_ENABLED`, `ZAPIER_ENABLED`, `AUDIENCE_NAV_ENABLED`,
`LEGACY_USERS_NAV_ENABLED`, `LEGACY_ALLOCATION_NAV_ENABLED`, `LANDING_PAGE_ENABLED`,
`BILLING_ENABLED`, `CERTIFICATES_ENABLED`, `COMMUNITY_ENABLED` (learner side), `EXPLORE_ENABLED` —
i.e. **all 15 flags are `false`** at `0d1eed995`; keep them identical in Gecko. **Never in any nav:** Settings→Integrations, Settings→Workspaces,
`/registrations` (linked only from `/reports`), `/announcements`, `/messages`, `/widget-preview`.

---

## 2. Known issues inherited from Pearl (decide: carry as-is or fix in Gecko)

Found while mapping. Gecko copies the code, so it copies these. **Default = carry as-is** (D1 is a
faithful replica); fix only items the owner approves — and if fixed, fix in Pearl too.

| # | Issue | Where | Impact |
|---|---|---|---|
| K1 | **No way to create the first admin/org on an empty DB.** API `signupGuard` allows a bootstrap signup when no org exists, but Better Auth has `disableSignUp:true` and the dashboard `/signup` page redirects tokenless visitors. | `apps/api/src/middlewares/signup-guard.ts`, `apps/dashboard/src/routes/(auth)/signup/+page.server.ts` | **Blocks go-live** → Phase 3 adds a bootstrap script. |
| K2 | **`/register` and `/register/thanks` are not in `PUBLIC_ROUTES`** → anonymous applicants are likely bounced to `/login`; public intake unreachable. | `apps/dashboard/src/lib/utils/constants/routes.ts` | Intake form broken for the public (verify live on Pearl). |
| K3 | Learners created via **registration approval / onboard endpoint** (`onboardLearner`) get a temp password that is discarded; they can only get in via *Forgot password* (needs working SMTP). `/register/thanks` promises a set-password email that is never sent. | `apps/api/src/services/...onboard*` (Appendix C §F) | Needs SMTP live before approving registrations. |
| K4 | **RLS is not in the repo.** Prod has RLS on 119/119 tables with **0 policies** (deny-all over PostgREST) + event trigger `ensure_rls_on_new_tables`. | Supabase only | Must be applied by hand → Phase 4 SQL. |
| K5 | **`/root/deploy.sh` is not in the repo.** | droplet only | Phase 3 commits it as `scripts/deploy.sh`. |
| K6 | Manager lands on a bare `/reports` (no sidebar/header/logout); `/announcements` forwards to an admin-only route (403 for managers). | dashboard | UX gap. |
| K7 | Stock ClassroomIO course pages (`submissions`, `marks`, `analytics`, `people/[personId]`, `exercises`) run on the old quiz model; exercise page is admin-only so learners 403 on admin-added exercises. Real coursework marking is **only** under `/caseload/**`. | Appendix B | Confusing for admins. |
| K8 | API looser than UI: `PUT /course/:id/landing-page` and exercise write endpoints accept course-team tutors. | API | Minor authz gap. |
| K9 | `GET /organization/setup` has no auth middleware. | API | Info leak (low). |
| K10 | Dead/stub screens: Billing & AI-credits (Polar removed), Settings→Integrations (Telegram, handlers commented out), Workspaces (upstream), Zapier ("coming soon"), Audience export (`alert`), Quiz play → `play.classroomio.com`, `/home` & `/welcome` always redirect. | Appendix A | Ship as-is (hidden). |
| K11 | Duplicate models: two lock models (`sequential_unlock` and `progressionMode`), two completion tables (`course_completion`, `course_completion_record`). | DB/API | Tech debt. |
| K12 | `/internal/*` cron endpoints have no scheduler in the repo. | API | Find out what (if anything) calls them on Pearl before go-live. |
| K13 | No container memory limits; dashboard build hard-codes an 8 GB Node heap. | compose / Dockerfile | Size the droplet at 8 GB (Phase 5). |
| K14 | ACCESS.md says Managers compose announcements; the route guard is admin-only. | docs | Doc drift. |

---

## 3. Open questions (must be answered before the phase that needs them)

| # | Question | Needed by |
|---|---|---|
| **Q1** | **CRM.** There is **no CRM↔LMS code** in either repo (LMSclassroom or project-spark). The LMS's only machine surface is `GET /register/courses` + `POST /register` (Bearer `PRIVATE_SERVER_KEY`) which creates a *pending registration*. What should "same Pearl CRM integration" do for Gecko? (a) CRM pushes enquiries into Gecko `/register`; (b) CRM reads Gecko learner data (needs a read-only DB role/view); (c) manual for now. | Phase 9 |
| Q2 | Domain, logo files, sender email address. | Phases 2, 5, 6 |
| Q3 | Fix any of K2/K3/K6–K9 in Gecko (and Pearl)? Default no. | Phase 3 |
| Q4 | Supabase plan: **Pro** recommended (PITR, no pausing, storage limit > 50 MB which video uploads need). | Phase 4 |
| Q5 | Droplet size: **4 vCPU / 8 GB** recommended (~$48/mo) vs Pearl's 2 vCPU / 4 GB. | Phase 5 |
| Q6 | SMTP provider (SES / Postmark / Resend / ZeptoMail). | Phase 6 |

---

## Phase 0 — Accounts and prerequisites

1. **Secrets folder** exists: `C:\Users\PC\Projects\_secrets\geckoprogrammes\`
   - `gecko.env` — the droplet `.env`. `BETTER_AUTH_SECRET`, `PRIVATE_SERVER_KEY`,
     `QUEUE_DASHBOARD_PASSWORD` are **already generated** (unique to Gecko). Every `FILL…` is filled in
     the phase that creates it. Never copy Pearl's values.
   - Record here as you go: Supabase DB password + ref, S3 keys, droplet IP, SSH key name, SMTP creds.
2. Accounts/access needed: GitHub org `Integer-Training` (repo `newlmsgecko` exists, empty);
   Supabase org (billing for Pro); DigitalOcean team; domain registrar/DNS for `{{GECKO_DOMAIN}}`;
   SMTP provider account.
3. Local tools: Node 22 + pnpm (version from root `package.json` `packageManager`), Docker, git,
   `openssl`, `psql` (optional).

**Done when:** all accounts reachable; `gecko.env` present with 3 generated secrets.

---

## Phase 1 — Create the Gecko repository

```bash
cd /c/Users/PC/Projects
git clone https://github.com/Integer-Training/LMSclassroom.git newlmsgecko
cd newlmsgecko
git remote rename origin pearl            # read-only reference to Pearl
git remote set-url --push pearl DISABLED  # never push Gecko work into Pearl
git remote add origin https://github.com/Integer-Training/newlmsgecko.git
git remote set-url --push upstream DISABLED   # ClassroomIO upstream: fetch-only
git push -u origin main                   # full history (keeps AGPL attribution)
```
- Keep the history (do **not** squash): it preserves upstream authorship/notices.
- Check no secrets are tracked: `git ls-files | grep -E '(^|/)\.env$'` → must be empty
  (`.env` is git-ignored; only `.env*.example` files are tracked).
- Local install & build sanity:
  `pnpm install` → `pnpm --filter @cio/utils run build && pnpm --filter @cio/db run build` →
  `pnpm --filter @cio/api run build` → API tests `pnpm --filter @cio/api test` (record pass/fail
  counts; must equal Pearl's baseline) → dashboard build
  `NODE_OPTIONS=--max-old-space-size=8192 pnpm -r --filter @cio/dashboard... build`.
- Create a project `CLAUDE.md` in the Gecko repo pointing to this file + the Gecko rules (localhost
  first, owner pushes/deploys, never touch Pearl).

**Done when:** `origin/main` of `newlmsgecko` == Pearl `0d1eed995` (or later agreed commit); local
API build + tests + dashboard build pass with the same counts as Pearl.

---

## Phase 2 — Rebrand the code to "Gecko Programmes"

Brand lives in **three places** — change all three (Appendix E §5.2):
1. **Code strings** (UI copy, `<title>`s, emails, locale JSON).
2. **Static assets** in `apps/dashboard/static/` (favicons, logos, manifest, OG image) — Appendix E §5.3.
3. **Database org row** (`organization.name`, `site_name`, `avatar_url`, `theme`) — set in Phase 7, not code.

Work list (exact file:line tables in **Appendix E §5.6 A–D**; counts at time of writing):
| Group | Count | Replace with | Notes |
|---|---|---|---|
| "Integer Training LMS" (UI copy, settings `<title>`s, course layout title fallback, `en.json`) | ~146 + locales | `{{BRAND}}` | `apps/dashboard/src/lib/utils/translations/*.json` — `en.json` plus 9 other locales (~250 more lines). |
| "Pearl LMS" / "Pearl" user-visible (13 `<title>`s: allocation, users, progression, dash, caseload…; `/welcome`; one tutor dialog) | ~28 | `{{BRAND}}` | localStorage key `pearl.dismissedBroadcasts` → may stay (internal) or rename to `gecko.` (harmless reset). |
| ClassroomIO vendor strings/URLs (`help@classroomio.com`, `api.classroomio.dev`, `myclassroomio.com`, `t.me/classroomio_bot`, `play.classroomio.com`, course sidebar footer link + "ClassroomIO" alt, MCP snippets `api.classroomio.com` / `@classroomio/mcp`, API page docs link) | ~170 | Gecko equivalents or remove | Hidden screens still get fixed (D6). |
| **Email layer** (`packages/email/src/templates/default.ts` masthead logo `brand.cdn.clsrio.com` + footer; `packages/email/src/utils/constants.ts` default From/Reply-To; every template subject/body; `"<org> (via Integer Training LMS)"` From display names in `packages/db/src/auth/email-verification.ts`, `apps/api/src/services/organization/invite.ts` and ~20 other services; ICS `PRODID`) | 21+ sites | `{{BRAND}}` / `{{SENDER_DOMAIN}}`; logo → Gecko logo hosted in the Gecko `media` bucket or `static/` | Deliberate code edits, not blind find/replace (Appendix E §5.6 D, docs/TODO-BRANDING.md). |
| `docker-compose.deploy.yaml` default `PUBLIC_SOURCE_REPO_URL` | 1 | `https://github.com/Integer-Training/newlmsgecko` | AGPL. |
| Assets: `favicon*`, `apple-touch-icon`, `logo*.svg/png`, `manifest.webmanifest` (`name`, `short_name`), OG image | ~10 files | Gecko logo set | Await `{{LOGO}}`; use a neutral placeholder until then. |

**Do NOT rename** (internal identifiers — Appendix E §5.5): `@cio/*` package names, the `classroomio`
RPC client variable, cookie prefix `classroomio`, `cio-org-id` header, `cio_org_id_` cookie, DB
table/column names, env var names, the `LICENSE` and upstream copyright notices.

**Colours:** unchanged (Appendix E §5.4 lists the tokens for reference).

**Done when:**
```bash
# zero user-visible hits outside comments/identifiers/LICENSE:
rg -n -i "integer training lms|pearl lms|epearl|epearlacademy" apps packages -g '!**/node_modules/**'
rg -n -i "classroomio\.com|clsrio\.com|classroomio_bot|myclassroomio|classroomio\.dev" apps/dashboard apps/api packages -g '!**/node_modules/**'
```
…return only allowed internal identifiers (list them in the PR), all 10 locale files updated, builds +
tests still green, and an email preview (Mailpit locally) shows the Gecko masthead/footer/From.

---

## Phase 3 — Repo-level additions required to launch (no behaviour change for users)

1. **Bootstrap script (fixes K1)** — `packages/db/src/scripts/bootstrap-owner.ts`, run once against the
   empty DB. One transaction, idempotent (abort if any organization exists). Inputs from env:
   `BOOT_EMAIL`, `BOOT_NAME`, `BOOT_PASSWORD`, `BOOT_ORG_NAME={{BRAND}}`, `BOOT_SITE_NAME={{SITE_NAME}}`.
   Creates, in order (exact columns: **Appendix D §3.7**): `user` (email_verified) → `account`
   (`provider_id='credential'`, bcrypt cost-10 hash — or call `auth.api.createUser` headless like
   `createOrgUser` does, then UPDATE the auto-created `profile`) → `profile`
   (`status='ACTIVE'`, verified, `settings.mustChangePassword=true`) → `organization` → 
   `organizationmember` (role_id 1, verified — **this becomes the permanent super admin**) →
   `organization_plan` (`ENTERPRISE`, `provider='selfhosted'`, active). Add a `pnpm --filter @cio/db
   bootstrap:owner` script + unit test. Recovery tool already exists:
   `SET_PW_EMAIL=… SET_PW_PASSWORD=… pnpm --filter @cio/db exec tsx src/scripts/set-password.ts`.
2. **Commit the deploy script (K5)** as `scripts/deploy.sh` (reconstructed in Appendix E §4.2, path
   `/opt/geckolms`; sequential builds api → dashboard → `up -d`; `=== COMPLETE ===` marker). On the
   droplet `/root/deploy.sh` just calls it.
3. **Commit the RLS SQL (K4)** as `packages/db/sql/rls-lockdown.sql` (Phase 4 step 6) so it is
   versioned, even though it is run by hand.
4. Optional, only if owner answers Q3: fixes for K2/K3/K6–K9, each with a test, mirrored to Pearl.

**Done when:** script + test merged on Gecko `main`; API tests green; dashboard build green.

---

## Phase 4 — Supabase project (Postgres + Storage)

1. Create project (name `GECKOLMS`), region **eu-west-1** (same as Pearl) or eu-west-2; plan per Q4.
   Strong DB password (no `@:/?#` or URL-encode it) → secrets folder.
2. **Connection strings** → `gecko.env`:
   `DATABASE_URL` = Transaction pooler `:6543`; `DIRECT_DATABASE_URL` = **Session pooler** `:5432`
   (droplets are IPv4-only — the direct `db.<ref>` host is IPv6). Leave `DATABASE_SSL` unset.
3. **Storage → S3**: enable S3 protocol, create S3 access keys → `OBJECT_STORAGE_ACCESS_KEY_ID/SECRET`.
   Endpoint `https://{{SB_REF}}.storage.supabase.co/storage/v1/s3`, `FORCE_PATH_STYLE=true` (compose).
4. **Buckets** (the repo never creates them) — must match Pearl exactly:
   | bucket | public? | holds |
   |---|---|---|
   | `documents` | **private** | lesson materials, learner coursework/drafts, tutor feedback files |
   | `videos` | **private** | lesson videos (+HLS) |
   | `media` | **public** | course images, avatars, org logo, OG images |
   Global upload limit (Settings → Storage) ≥ largest app cap (video 800 MB default; free tier = 50 MB).
5. CSP vars → `gecko.env`: `CSP_CONNECT_SRC_DOMAINS` and `CSP_MEDIA_SRC_DOMAINS` = `https://{{SB_REF}}.storage.supabase.co`.
6. **After the first API boot (Phase 7 step 3)** run the RLS lockdown (mirrors Pearl: RLS on, no policies):
   ```sql
   DO $$ DECLARE r record; BEGIN
     FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
       EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
     END LOOP; END $$;

   CREATE OR REPLACE FUNCTION public.ensure_rls_on_new_tables() RETURNS event_trigger
   LANGUAGE plpgsql AS $$ DECLARE obj record; BEGIN
     FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
       WHERE command_tag = 'CREATE TABLE' AND schema_name = 'public' LOOP
       EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', obj.object_identity);
     END LOOP; END $$;
   DROP EVENT TRIGGER IF EXISTS ensure_rls_on_new_tables;
   CREATE EVENT TRIGGER ensure_rls_on_new_tables ON ddl_command_end
     WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.ensure_rls_on_new_tables();
   ```
   (Compare with Pearl's actual function: `select pg_get_functiondef('public.ensure_rls_on_new_tables'::regproc);`
   on project `cvtmymxxjgjshrzsjxnj` — read-only — and copy it verbatim if it differs.)
   The app connects as `postgres` (owner, bypasses RLS) so nothing in the app changes.

**Done when** (SQL editor on the Gecko project):
```sql
select (select count(*) from pg_tables where schemaname='public') tables,          -- 119
       (select count(*) from pg_tables where schemaname='public' and rowsecurity) rls, -- 119
       (select count(*) from pg_policies where schemaname='public') policies,      -- 0
       (select string_agg(name||':'||public,',') from storage.buckets) buckets;    -- documents:false,media:true,videos:false
```
and Supabase Security Advisor shows no "RLS disabled" errors.

---

## Phase 5 — DigitalOcean droplet, DNS, TLS

1. Droplet: Ubuntu 24.04, **`s-4vcpu-8gb`** (Q5), region `lon1`, monitoring on, new SSH key
   `ssh-keygen -t ed25519 -f ~/.ssh/geckolms_deploy` (**do not reuse** `pearllms_deploy`).
2. Firewall: DO Cloud Firewall inbound 22/80/443 only; host `ufw allow OpenSSH 80 443`. Never publish
   3081/3082/6379.
3. Swap 4 GB (`fallocate`…, `vm.swappiness=10`); install Docker (`get.docker.com`) + compose plugin + git.
4. `git clone https://github.com/Integer-Training/newlmsgecko.git /opt/geckolms`;
   copy `gecko.env` → `/opt/geckolms/.env`, `chmod 600`.
5. DNS: `A {{APP_DOMAIN}} → {{DROPLET_IP}}` (TTL 300), optional `CAA 0 issue "letsencrypt.org"`.
   Must resolve **before** the first `up -d` (Caddy gets the cert via HTTP-01). Single host only.
6. `/root/deploy.sh` → `exec /opt/geckolms/scripts/deploy.sh "$@"`.

**Done when:** `ssh -i ~/.ssh/geckolms_deploy root@{{DROPLET_IP}} 'docker compose version; free -h; swapon --show'`
OK and `dig +short {{APP_DOMAIN}}` returns the droplet IP.

---

## Phase 6 — Email (new SMTP + sender domain)

1. Create the Gecko sender identity at the provider (Q6) on `{{SENDER_DOMAIN}}`; if SES, request
   production access (leave sandbox) before inviting real people.
2. DNS: **SPF** (provider include), **DKIM** (provider CNAMEs/TXT), **DMARC**
   `_dmarc.{{SENDER_DOMAIN}}  v=DMARC1; p=none; rua=mailto:dmarc@{{GECKO_DOMAIN}}; fo=1` → tighten to
   `quarantine` after 2–4 clean weeks.
3. `gecko.env`: `SMTP_HOST`, `SMTP_PORT=587`, `SMTP_USER`, `SMTP_PASSWORD`,
   `SMTP_SENDER="Gecko Programmes" <no-reply@{{SENDER_DOMAIN}}>`, `SMTP_REPLY_TO`.
   **Never** set `SMTP_ALLOW_INSECURE` in prod.
4. Both **api** (auth emails, synchronous) and **jobs** (everything else) use these vars.

**Done when:** provider shows the domain verified (SPF+DKIM pass); a test send lands in Gmail inbox with
`dkim=pass spf=pass dmarc=pass` in headers. (SMTP must be live **before** Phase 7 step 5 because of K3.)

---

## Phase 7 — First deploy, bootstrap, organisation setup

1. Fill every `FILL` in `/opt/geckolms/.env` (25 keys — Appendix E §3.1). Confirm with
   `grep -c FILL /opt/geckolms/.env` → `0`.
2. First deploy, **detached** (SSH drops must not kill it):
   `nohup /root/deploy.sh > /root/deploy.log 2>&1 &` — ~5–8 min on 8 GB (25–45 on 4 GB). Only one deploy
   at a time, ever. Success marker `=== COMPLETE`; failure = `failed to solve|exited with code [1-9]`
   (do **not** grep `ERROR:` — the Dockerfile echoes a literal guard string).
3. API boot auto-runs `db:setup`: roles → advisory lock → baseline → `drizzle-kit migrate`
   (27 migrations `0000`–`0026`) → essential seed (roles 1/2/3, submission statuses, question types).
   Check: `docker compose -f docker-compose.deploy.yaml logs api | grep -i migrat`.
   Then run the **Phase 4 step 6 RLS SQL**.
4. Bootstrap the super admin (Phase 3 script), from the droplet:
   `docker compose -f docker-compose.deploy.yaml exec api sh -lc 'BOOT_EMAIL=… BOOT_NAME=… BOOT_PASSWORD=… BOOT_ORG_NAME="Gecko Programmes" BOOT_SITE_NAME=geckoprogrammes pnpm --filter @cio/db bootstrap:owner'`
   (password never in shell history: `read -s BOOT_PASSWORD` first).
5. Log in at `https://{{APP_DOMAIN}}/login` → forced password change → lands on
   `/org/geckoprogrammes/dash`. Settings → **Organisation**: name `Gecko Programmes`, logo (`{{LOGO}}`,
   uploads to `media`), favicon, theme colour = Pearl's; Settings → **Customize LMS** to match Pearl's
   values (read Pearl's `organization.customization` / `theme` read-only and copy).
6. Create test accounts through the UI (Admins / Tutors / Learners pages — each shows a one-time temp
   password): `admin2`, `manager1` (via hidden `/org/geckoprogrammes/users` — the only UI that can
   create a Manager), `tutor1`, `tutor2`, `learner1..3`. Use `+test` aliases on a mailbox you control.

**Done when:** `https://{{APP_DOMAIN}}/proxy/health` → `{"status":"ok"…}`; valid TLS; login page shows
"Source code (AGPL-3.0)" linking to `newlmsgecko`; super admin can log in; RLS check (Phase 4) passes.

---

## Phase 8 — Screen-by-screen verification (every view, every role)

Build a tiny test course first: **Course "GECKO TEST"** with 3 lessons, each with a coursework unit
(document `kind` workbook / casestudy / assignment, one with `allowDrafts`, one with `dueAt`); assign
`tutor1` to the course team; allocate `learner1`,`learner2` to `tutor1` and `learner3` to `tutor2`
(Tutors / Progression / allocation UI). Then walk **every** row below as the stated role. Each row's
full spec (UI, actions, API calls, tables, gating) is in the referenced appendix entry; a row passes when
the screen renders without console/API errors, every action in its appendix entry works, and the gating
behaves as stated (wrong role → redirect/403).

### 8.1 Auth & public (anonymous) — Appendix C §C–E
`/login` · `/logout` · `/forgot` (email arrives) · `/reset` · `/signup` (redirects tokenless) ·
`/register` (K2 — expected to bounce unless fixed) · `/register/thanks` · `/onboarding` ·
`/verify-email-error` · `/auth-failed` · `/invite/[hash]` · `/invite/link/[hash]` · `/404` ·
public catalogue `/courses` · `/course/[slug]` · `/course/[slug]/enroll` · `/course/[slug]/lesson/[itemSlug]` ·
`/csp-report` (endpoint) · `/` (→ login / role home) · `/change-password` (forced on first login).

### 8.2 Admin — Appendix A (sets A & B) and Appendix B §A
**Shell:** admin sidebar matches the nav map (Appendix A §1, Appendix A-B "Effective admin nav");
org switcher; broadcast banner; notifications.
**Visible in nav:** Dashboard `/dash` · Reports → Learners, Courses, Marking, Completions, Referrals,
Tutor feedback, Activity log · Courses · Media · Community (+ `[cslug]`, `ask`) · Learners · Tutors ·
Admins · Progression · Broadcasts · Settings → Profile, Notifications, Organisation (General, Domains,
Teams, Customize LMS), Auth (+ SSO, Token-auth).
**Hidden (URL-only, must still work):** `/org/[slug]` root · Home · Cohorts (+ `/cohorts/[id]/courses|newsfeed|people|settings`) ·
Tags · Widgets (+ `/widgets/[widgetId]`, `/widget-preview`) · Audience (+ `import`, `[...params]`) ·
Users (legacy — creates Managers) · Allocation (legacy) · MCP · API · Zapier · Analytics · Compliance ·
Teams-overview · Quiz (+ `[slug]` editor) · Setup · `/automation` redirect · Settings → Billing,
AI credits, AI tutor, Integrations, Landing page (+ `edit`), Workspaces · `/registrations` (approve the
test registration) · `/announcements` · `/messages` (+ `[threadId]`) · `/home` · `/welcome`.
**Course workspace (admin view):** `/courses/[id]` (news feed) · `lessons` · `lessons/[lessonId]`
(lesson editor + coursework documents) · `exercises/[exerciseId]` · `settings` · `people` ·
`people/[personId]` · `analytics` · `submissions` · `marks` · `attendance` · `compliance` ·
`certificates` · `certificates/editor` · `landingpage` · `ai-tutor`.

### 8.3 Manager — Appendix A-B "Shared top-level routes"
Lands on `/reports` (no sidebar, K6) · `/registrations` via its link · `/org/*` → 403 · `/announcements` → 403 (K6).

### 8.4 Tutor (`tutor1`) — Appendix B §B
`/caseload` (sees **only** learner1+2, not learner3) · `/caseload/[learnerId]` (learner3 → 403) ·
`/caseload/courses` · `/caseload/courses/[courseId]` · `/caseload/courses/[courseId]/units/[lessonId]` ·
`/caseload/courses/[courseId]/submissions?lessonId=&assessmentKey=` (grading drawer: Pass / Refer +
feedback + file; cannot grade/download learner3) · `/caseload/messages` · `/caseload/progression` ·
`/courses/[id]/lessons/[lessonId]` read-only content view · `/org/*` → 403.

### 8.5 Learner (`learner1`) — Appendix C §A–B
`/lms` (dashboard; tutor-feedback popup appears at 2 passed units) · `/lms/mylearning` ·
`/lms/exercises` (assessments board) · course → unit: **save draft → reopen draft → upload file →
submit** · see tutor feedback → resubmit after Refer · `/lms/settings` · `/lms/settings/notifications` ·
`/lms/settings/integrations` · hidden: `/lms/certificates`, `/lms/cohorts`, `/lms/community`
(+ `ask`, `[slug]`), `/lms/explore` · `/messages` · `/org/*` → 403.

### 8.6 End-to-end flows (Appendix B §D, Appendix C "Learner journey")
1. Admin builds course + coursework units + assigns tutor + allocates learners.
2. Learner: draft → submit. Tutor receives the "submission created" email.
3. Tutor marks **Refer** with feedback → learner email → learner resubmits → tutor marks **Pass**.
4. Progression/unlock moves the learner on; completion recorded; reports (Learners, Courses, Marking,
   Completions, Activity log) reflect it; tutor-feedback appears in Reports → Tutor feedback after the
   learner submits it.
5. Registration: submit `/register` (or `POST /register` with the Bearer key) → admin approves at
   `/registrations` → learner sets password via *Forgot password* (K3) → logs in.
6. Broadcast to learners → banner shows → dismiss persists.
7. Upload limits: a 20 MB PDF and a video upload succeed (body-size + storage caps).

### 8.7 Every email template fires (Appendix D §5 — 29 templates)
Trigger each at least once (or render in Mailpit locally) and confirm Gecko branding + working links to
`{{APP_DOMAIN}}`.

**Done when:** every row in 8.1–8.7 is ticked in a copy of this checklist committed as
`docs/GECKO-ACCEPTANCE.md` with date, tester and any defects (defects → fixed or logged as known).

---

## Phase 9 — CRM connection (blocked on Q1)
Options once answered (details Appendix E §2.8):
- **(a) CRM pushes enquiries** → CRM calls `POST https://{{APP_DOMAIN}}/proxy/register` with a key.
  Recommended: add a **dedicated** `CRM_INTAKE_KEY` route guard rather than sharing `PRIVATE_SERVER_KEY`
  (which also secures the dashboard↔API channel). CRM side: a per-brand LMS endpoint/key setting.
- **(b) CRM reads LMS data** → create a read-only Postgres role on the Gecko project limited to named
  views (e.g. learner status/progress), connection string stored in the CRM's secrets.
- **(c) Manual** for launch.
No outbound webhook exists (the `webhooks` queue is declared but dead).

---

## Phase 10 — Go-live and operations
1. Delete/disable test accounts and the GECKO TEST course (or keep a clearly-named sandbox course
   unpublished). Never delete via raw SQL without the owner's approval.
2. Backups: Supabase Pro PITR (7 days) + daily; quarterly restore drill to a scratch project (docs/RUNBOOK.md §7).
3. Monitoring: DO uptime checks on `https://{{APP_DOMAIN}}/login` (200) and `/proxy/health`
   (body `"status":"ok"`), cert-expiry alert < 14 days.
4. Deploy discipline: owner pushes `main` and runs `ssh -i ~/.ssh/geckolms_deploy root@{{DROPLET_IP}} "bash ~/deploy.sh"`;
   one deploy at a time; droplet HEAD must equal `origin/main` (AGPL).
5. Logs: `docker compose -f docker-compose.deploy.yaml logs -f api|jobs|dashboard|caddy|redis`;
   API errors carry `x-correlation-id`.
6. Monthly `pnpm audit` + image refresh. Port relevant Pearl fixes by cherry-pick (`git fetch pearl`).
7. Telemetry/egress check from docs/DEPLOY.md §5 (only Supabase, SMTP, optional embed hosts).

**Done when:** owner signs off `docs/GECKO-ACCEPTANCE.md`; DNS TTL raised to 3600; uptime checks green 48 h.

---

## Phase 11 — (Optional, on request) Copy course CONTENT from Pearl
Only when the owner asks. Copies course structure/content — **never** people, enrolments, allocations,
submissions, progress or audit rows. Tables in FK-safe order, columns to remap
(`organization_id`, `group_id`, author/profile ids → the Gecko super admin), exclusions and the storage
objects (`documents/materials/{courseId}/…`, `media` images) are in **Appendix E §7**. Method: read-only
export from Pearl → transform ids in a script → insert into Gecko inside one transaction → copy storage
objects bucket-to-bucket with the S3 API → rewrite URLs that embed the Pearl `{{SB_REF}}`. Verify lesson
and document counts per course match Pearl. The owner runs any write SQL (Supabase editor) after review.

---

## Appendices (generated inventories)
- **Appendix A** — Admin screens, set A (org admin area, reports) and set B (app shell & role routing,
  settings, cohorts, shared top-level routes).
- **Appendix B** — Course workspace `courses/[id]/**` and tutor caseload `caseload/**`, with end-to-end flows.
- **Appendix C** — Learner area, auth, invites, public org site, auth mechanism, other apps.
- **Appendix D** — Backend: API route map (431 handlers), role matrix, database (119 tables), jobs,
  emails, packages, tests.
- **Appendix E** — Infrastructure, external connections, env catalogue, deploy pipeline, branding
  inventory, AGPL checklist, course-copy procedure.


---

# Appendix A — Admin screens

## 10 - Org admin screens (set A) - PearlLMS

Scope: `apps/dashboard/src/routes/(app)/org/[slug]/**` except `settings/**`. Written read-only from the repo at C:\Users\PC\Projects\LMSclassroom. All paths below are repo-relative unless stated. `[slug]` = org siteName.

### 0. Cross-cutting facts (read first)

**One server-side gate for the whole subtree.** `apps/dashboard/src/routes/(app)/org/[slug]/+layout.server.ts` calls `requireAdmin(locals)` (`apps/dashboard/src/lib/server/guards.ts`: role must be `ADMIN`, anonymous -> 303 /login, other roles -> 403) and then `requireSameOrg(locals, orgId)` (slug-resolved org must equal the actor's org). Org id is resolved from the slug via `getOrgBySiteName` (API-key header) and cached in cookie `cio_org_id_<slug>` (7 days). So **every screen below is ADMIN-only at the SvelteKit layer, regardless of the nav `requiresAdmin` flag or per-page `requireManagerOrAdmin`**. MANAGER and TUTOR get a 403 on any `/org/[slug]/...` URL. Managers/tutors use other top-level routes instead (`/reports`, `/caseload`, outside this scope). The API is the real boundary and re-checks every call (`requireAdmin` / `requireManagerOrAdmin` from `apps/api/src/middlewares/guards.ts`, or older `orgAdminMiddleware` / `orgMemberMiddleware`).

**Org shell** (`+layout.svelte`): renders `OrgSidebar` + `AppHeader`; non-selfhosted shows `AddOrgModal`; if the client store says the user is a student (`isOrgStudent`) it redirects to `/lms`; `data.orgName === '*'` shows skeletons then redirects to the real siteName.

**Post-login home** (`lib/utils/functions/routes/homeForRole.ts`): ADMIN -> `/org/{siteName}/dash`, TUTOR -> `/caseload`, MANAGER -> `/reports`, student -> `/lms`.

**Feature flags** (`apps/dashboard/src/lib/utils/constants/features.ts`, all `export const`, build-time, currently false): `AI_ENABLED`, `ORG_HOME_ENABLED`, `COHORTS_ENABLED`, `TAGS_ENABLED`, `WIDGETS_ENABLED`, `API_ACCESS_ENABLED`, `ZAPIER_ENABLED`, `AUDIENCE_NAV_ENABLED`, `LEGACY_USERS_NAV_ENABLED`, `LEGACY_ALLOCATION_NAV_ENABLED` (plus out of scope here: `EXPLORE_ENABLED`, `COMMUNITY_ENABLED`, `CERTIFICATES_ENABLED`, `LANDING_PAGE_ENABLED`, `BILLING_ENABLED`). Flags only hide the nav link; the route and its API remain reachable by URL (except `/lms` ones, out of scope).

**RPC pattern.** Dashboard calls the Hono API through the typed client `classroomio` (`apps/dashboard/src/lib/utils/services/api`); server loads use `safeServerApi(...)` with `getApiHeaders(cookies, orgId)` (sends cookie + `cio-org-id`). Client side goes via the `/proxy` hop. Paths below are given as the **API path** (client = `classroomio.<path with dots>`).

**i18n.** `apps/dashboard/src/lib/utils/translations/en.json` has already been string-replaced from "ClassroomIO" to "Integer Training LMS" (e.g. `by_classroomio`, `classroomio_home`, `custom_domain_not_classroomio`). Many pages append " - Integer Training LMS" to `<title>`.

**Style of newer PearlLMS pages** (admins, learners, tutors, allocation, users, broadcasts, progression, dash, reports): English literals hardcoded in the Svelte files, NOT in en.json. Older upstream pages use `$t('...')` keys.

### 1. Org admin navigation map

Source: `apps/dashboard/src/lib/features/ui/navigation/org-navigation.ts` (`baseNavConfig`, grouped by `GROUP_ORDER` home / content / people / automation / ungrouped). Rendered by `lib/features/ui/sidebar/org-sidebar/nav-main.svelte` via `getOrgNavigationGroups($currentOrgPath, $currentOrg, $isOrgAdmin, ...)`. An item with `requiresAdmin` is skipped for non-admins unless `disableWhenNotAdmin` (then shown disabled). Because the org layout is ADMIN-only anyway, these flags are belt-and-braces. Labels come from en.json `org_navigation.*`.

| # | Group | Label (en.json) | Path | Visible now? | Gating |
|---|---|---|---|---|---|
| 1 | home | Home | `/org/[slug]` | NO - hidden | `ORG_HOME_ENABLED=false` |
| 2 | home | Dashboard | `/dash` | yes | none in nav (layout = ADMIN) |
| 3 | home | Reports (collapsible, href `#`, parent path `/reports/learners`) | - | yes | none on parent |
| 3a | | Learners | `/reports/learners` | yes | none in nav; page server `requireManagerOrAdmin` |
| 3b | | Courses | `/reports/courses` | yes | same |
| 3c | | Marking | `/reports/marking` | yes | same |
| 3d | | Completions | `/reports/completions` | yes | same |
| 3e | | Referrals | `/reports/referrals` | yes | `requiresAdmin` |
| 3f | | Tutor feedback | `/reports/tutor-feedback` | yes | `requiresAdmin` |
| 3g | | Activity log | `/reports/activity-log` | yes | `requiresAdmin` |
| - | home | (Setup / Get started) | `/setup` | NOT in nav at all | removed (comment: "not needed for a live provider") |
| 4 | content | Courses | `/courses` | yes | none |
| 5 | content | Cohorts | `/cohorts` | NO - hidden | `COHORTS_ENABLED=false` |
| 6 | content | Media | `/media` | yes | none |
| 7 | content | Tags | `/tags` | NO - hidden | `TAGS_ENABLED=false`; also `requiresAdmin` |
| 8 | content | Widgets | `/widgets` | NO - hidden | `WIDGETS_ENABLED=false` |
| 9 | people | Community | `/community` | yes (always, not behind `COMMUNITY_ENABLED`; that flag only hides the learner-side item) | none; nestedRoutes `ask` |
| 10 | people | Learners | `/learners` | yes | `requiresAdmin` |
| 11 | people | Tutor Management | `/tutors` | yes | `requiresAdmin` |
| 12 | people | Admin Management | `/admins` | yes | `requiresAdmin` |
| 13 | people | Learner Progressions | `/progression` | yes | `requiresAdmin` |
| 14 | people | Audience | `/audience` | NO - hidden | `AUDIENCE_NAV_ENABLED=false`; `upgradeResource: 'students'` |
| 15 | people | Users | `/users` | NO - hidden | `LEGACY_USERS_NAV_ENABLED=false`; `requiresAdmin` |
| 16 | people | Tutor allocation | `/allocation` | NO - hidden | `LEGACY_ALLOCATION_NAV_ENABLED=false`; `requiresAdmin` |
| 17 | people | Broadcasts | `/broadcasts` | yes | `requiresAdmin` |
| 18 | automation | MCP (`automation.tabs.mcp`) | `/mcp` | NO - hidden | `AI_ENABLED=false`; `requiresAdmin`+`disableWhenNotAdmin` |
| 19 | automation | API (`automation.tabs.api`) | `/api` | NO - hidden | `API_ACCESS_ENABLED=false`; same admin flags |
| 20 | automation | Zapier | `/zapier` | NO - hidden | `ZAPIER_ENABLED=false`; same admin flags |
| 21 | (none) | Settings (collapsible, href `#`) | `/settings/**` | yes | out of scope (other agent) |

Routes that exist but have **no nav entry at all** (in-scope): `/analytics`, `/compliance`, `/teams-overview`, `/quiz`, `/quiz/[slug]`, `/setup`, `/automation` (redirect), `/audience/import`, `/audience/[...params]`, `/community/[cslug]`, `/community/ask` (nested under Community), `/org/[slug]` root (Home flag).

**Effective visible sidebar today (admin):** Dashboard, Reports (7 sub-items), Courses, Media, Community, Learners, Tutor Management, Admin Management, Learner Progressions, Broadcasts, Settings.

---

### 2. Screens

#### Org shell + root page — `/org/[slug]`
- **Roles:** ADMIN only (layout `requireAdmin` + `requireSameOrg`). HIDDEN from nav: nav item "Home" gated by `ORG_HOME_ENABLED=false`. Reachable by URL; also target of tag/widget 401/403 redirects (`redirect(302, /org/${slug})`) and the old `*` slug redirect.
- **Reached from:** direct URL only; redirects from `/tags`, `/widgets` on 401/403.
- **Purpose:** Upstream "Home" landing. With AI off it degrades to a stub with two buttons.
- **UI & actions:** If `AI_ENABLED` true: AI `CourseCreator` composer (prompt, level beginner/intermediate/advanced, model picker, 3 `COURSE_TEMPLATES` cards) and a 3-step "drafting" animation, then creates a SELF_PACED course and goes to `/courses/{id}/lessons`. With `AI_ENABLED=false` (current): centred heading "Courses" and two buttons, "Dashboard" -> `/org/{slug}/dash`, "Courses" -> `/org/{slug}/courses`.
- **API calls:** `+page.server.ts` only returns `orgName`. If AI on: `aiAssistantApi.generateCourseMeta` (AI endpoint) and `courseApi.create` -> `POST /course`. Files: `apps/dashboard/src/routes/(app)/org/[slug]/+page.svelte`, `+page.server.ts`, `+layout.svelte`, `+layout.server.ts`.
- **Data:** none directly (course on create).
- **Wired?:** Layout/guard fully working. Root page: AI branch is upstream code, dead while `AI_ENABLED=false`; fallback stub works. Effectively an unused screen.
- **Brand strings:** `<title>Home - Integer Training LMS</title>`; layout logs `[org/+layout.server]`. No Pearl/ClassroomIO literals on the page itself.

#### Admin Dashboard — `/org/[slug]/dash`
- **Roles:** ADMIN (layout). Nav: in nav, no flag. API `GET /dash/admin-overview` and `/dash/online-now` are `requireManagerOrAdmin` + `requireSameOrg` (so API allows Manager, UI route does not). Admin post-login home.
- **Reached from:** sidebar "Dashboard"; login redirect (`homeForRole`); root-page button.
- **Purpose:** Platform overview: KPIs, alerts, charts, live "online now" panel, tutor and course tables.
- **UI & actions:** Skeleton grids until loaded. `HeadlineTiles` (KPI cards: Total Learners, Total Tutors, Active Courses, Awaiting Marking, Pending Registrations, Pass Rate, Avg Turnaround, Active Broadcasts, Unverified IDs, Open Message Threads, Active Learners (30d), Completed This Month, Certificates Earned, SLA Breaches). `AlertCards` (Inactive Learners, Overdue, Imminent Deadlines, Awaiting Draft Feedback, Pending Registrations, Unverified IDs). `ChartsGrid` (Monthly Enrollment, Submissions Over Time, Study Hours - org-wide, per month). `OnlineUsersPanel` (role chips Learners/Tutors/Managers/Admins + table Name/Email/Role/Last active; polled every 45 s). `TutorPerformanceTable` (Name, Email, Learners, Awaiting Marking, Inactive, Avg Turn. (days), Pass Rate %) with "Export CSV". `CourseOverviewTable` (Course, Enrolled, Active (30d), Assessments, Completion bar) with "Export CSV". CSV via `lib/features/admin-dashboard/utils/export-csv.ts` (client-side).
- **API calls:** `GET /dash/admin-overview?orgId=`, `GET /dash/online-now?orgId=` (`apps/api/src/routes/dash/stats.ts`, services `apps/api/src/services/dash/admin-overview.ts`). Files: `routes/(app)/org/[slug]/dash/+page.svelte`, `+page.server.ts` (returns orgId, siteName only), `lib/features/admin-dashboard/{pages/admin-dashboard.svelte, api/admin-dashboard.svelte.ts, components/*}`.
- **Data:** read: organizationmember, profile, groupmember, course, tutor_allocation, coursework_submission, coursework_result, course_completion, course_certificate_issue, registration, id_verification, announcement, message_thread, unit_time_spent, analytics_login_events (via `@cio/db/queries/dash`, `reports`, `coursework`, `analytics`). Overview is cached in-process in the API.
- **Wired?:** Fully working, PearlLMS-native.
- **Brand strings:** `<title>Admin Dashboard — Pearl LMS</title>`; code comments "PearlLMS".

#### Learner Management — `/org/[slug]/learners`
- **Roles:** ADMIN. Nav `requiresAdmin`. API `/organization/management/*` all `requireAdmin` (service re-asserts ADMIN).
- **Reached from:** sidebar People > Learners.
- **Purpose:** Org-wide learner roster with KPIs; create learner (enrolled + tutor-assigned), reset password, impersonate, suspend/reactivate.
- **UI & actions:** Header "Learner Management" + "New Learner" button. 5 KPI tiles (Total, Active, Inactive = no login 30+ days, Created = never logged in, Suspended). Table "Learner Details": filters Activity (All/Active/Inactive/Created/Suspended), Course (derived from rows), free-text Search (name/email), Reset; "Export CSV" (Name, Email, Tutor, Course count, Courses, Time spent, Last login, Status; client-side `downloadCsv`). Columns: expander (course badges), Name, Email, Tutor (or "Unassigned"), Courses, Time spent, Last login, Status badge, Actions = "Login As" (impersonation), "Reset Password", "Suspend"/"Reactivate". Client pagination 10/25/50/100. Empty state "No learners yet — create one to get started." `CreateLearnerDialog`: First name, Last name, Email (all required, max 100 chars name), Course (required select, from `/management/options`), Tutor (required select); on success a `RevealPanel` shows the one-time temporary password. `ResetPasswordDialog` also uses `RevealPanel`.
- **API calls:** `GET /organization/management/learners`; `GET /organization/management/options` (courses + tutors); `POST /organization/management/learners` body `{firstName,lastName,email,courseId(uuid),tutorId(uuid)}`; `POST /organization/management/members/:memberId/reset-password`; `PUT /organization/users/:memberId/status` (ACTIVE|DEACTIVATED); `POST /organization/management/members/:memberId/login-as` (sets signed cookie `imp_admin` + readable cookie `impersonating`, returns login-link path; helper `lib/utils/functions/impersonation.ts`; return via `POST /account/stop-impersonating`). Files: `lib/features/learner-management/{pages/learner-management.svelte, api/learner-management.svelte.ts, components/{create-learner-dialog,reset-password-dialog,reveal-panel}.svelte}`, API `apps/api/src/routes/organization/management.ts`, `apps/api/src/services/organization/management.ts`, `routes/(app)/org/[slug]/learners/+page.svelte`.
- **Data:** read: organizationmember, profile, user/session (last login), groupmember (enrolments), tutor_allocation, unit_time_spent, analytics_login_events. Write: user/account (Better Auth admin.createUser with generated password), profile, organizationmember (roleId LEARNER), groupmember (course enrolment), tutor_allocation, audit_event (`recordAudit`), organizationmember/profile status.
- **Wired?:** Fully working. Email delivery of credentials is dormant: the temp password is revealed on screen only (comments say "email delivery is dormant").
- **Brand strings:** `<title>Learner Management</title>` only. None hardcoded.

#### Tutor Management — `/org/[slug]/tutors`
- **Roles:** ADMIN. Nav `requiresAdmin`; API `requireAdmin`.
- **Reached from:** sidebar People > Tutor Management.
- **Purpose:** Org tutor roster; create tutor; assign which courses a tutor teaches; reset password; login-as; suspend.
- **UI & actions:** Header "Tutor Management" + "New Tutor". Card "Tutor Accounts" with search (name/email) and "Export CSV" (First name, Last name, Email, Caseloads, Learners, Status). Table: First name, Last name, Email, Courses, Learners, Status (Active/Suspended), Actions = "Courses" (opens `ManageCoursesDialog` with `CourseMultiselect`), "Login As", "Reset Password", Suspend/Reactivate. `CreateTutorDialog`: First name, Last name, Email, optional course multiselect; reveals temp password. Empty "No tutors yet — create one to get started."
- **API calls:** `GET /organization/management/tutors`; `POST /organization/management/tutors` `{firstName,lastName,email,courseIds?}`; `GET /organization/management/course-options`; `GET|PUT /organization/management/tutors/:memberId/courses` `{courseIds[<=200]}`; `POST .../members/:memberId/reset-password`; `PUT /organization/users/:memberId/status`; `POST .../members/:memberId/login-as`. Files: `lib/features/tutor-management/{pages/tutor-management.svelte, api/tutor-management.svelte.ts, components/{create-tutor-dialog, manage-courses-dialog, course-multiselect, reset-password-dialog}.svelte}`; `routes/.../tutors/+page.svelte`.
- **Data:** organizationmember (role TUTOR), profile, user, groupmember (TUTOR rows on courses = Moodle-style course-teacher link), tutor_allocation (learner counts), audit_event. (Memory note: course->tutor assignment shipped 2026-09; `isAllocatedTutor` is allocation-only.)
- **Wired?:** Fully working. Note CSV header says "Caseloads" while the column is "Courses".
- **Brand strings:** `<title>` not customised beyond generic; none hardcoded.

#### Admin Management — `/org/[slug]/admins`
- **Roles:** ADMIN. Nav `requiresAdmin`; API `requireAdmin`. "New Admin" button and `POST /management/admins` only for the **super admin** (earliest admin, derived; `canCreateAdmins` flag from API, enforced in service `createAdmin`). Super admin row and own row cannot be reset.
- **Reached from:** sidebar People > Admin Management.
- **Purpose:** Roster of org admins; reset other admins' passwords; super admin can mint new admins.
- **UI & actions:** Header "Admin Management" / "Reset admin passwords · {org name}". Card "Admin Accounts" with count badge + search. Table: First name, Last name, Email, Role (badge "Super Admin" or "Admin"), Status (Active/Suspended), Actions ("Protected" for super admin, "Use Change Password" for self, else "Reset Password"). `CreateAdminDialog` (First, Last, Email all required; reveals temp password via shared `RevealPanel`). Empty state "No admins found".
- **API calls:** `GET /organization/management/admins`; `POST /organization/management/admins` `{firstName,lastName,email}`; `POST /organization/management/members/:memberId/reset-password`. Files: `lib/features/admin-management/{pages/admin-management.svelte, api/admin-management.svelte.ts, components/{create-admin-dialog, reset-password-dialog}.svelte}`; shares `learner-management/components/reveal-panel.svelte`.
- **Data:** organizationmember (roleId ADMIN), profile, user, session(last login), audit_event.
- **Wired?:** Fully working.
- **Brand strings:** none (`<title>Admin Management</title>`).

#### Learner Progressions — `/org/[slug]/progression`
- **Roles:** ADMIN. Nav `requiresAdmin`; API `requireAdmin` (org-wide, every learner).
- **Reached from:** sidebar People > Learner Progressions.
- **Purpose:** Org-wide per-learner progression table (activity, completion, workbooks, case studies) with drill-down per course/unit.
- **UI & actions:** Header "Learner Progressions" / "All learners · {org}". 6 KPI tiles (Total learners, Active, Inactive, Not started, Avg completion %, At risk). Filters: Activity (All/Active/Inactive/Created), Progression band (All, 0-25, 26-50, 51-75, 76-100%), Course (All Courses or one; re-fetches server-side), Reset, Search, rows-per-page. Exports: Excel and PDF (jsPDF + autotable, lazy-loaded, current filtered rows). Table: expander, Learner Name, Start Date, Activity, Current % (bar), Workbooks "x / y Passed", Case Studies "x / y Passed". Expanded row: per-course WB/CS summary and a unit table (Assignment/Unit, Document, Submitted, Marked, Status Pass/Refer, Time Spent). Empty "No learners to show".
- **API calls:** `GET /organization/management/progression?courseId=` and `GET /organization/management/progression/:learnerId` (detail, lazy on expand). Files: `lib/features/learner-progressions/{pages/learner-progressions.svelte, api/learner-progressions.svelte.ts}`; `apps/api/src/services/progression/progression.ts`; `routes/.../progression/+page.svelte`.
- **Data:** read: organizationmember, profile, groupmember, course/lesson, coursework_submission, coursework_result, unit_time_spent, tutor_allocation, analytics (last seen), lesson_completion/progress queries (`computeLearnerCourseProgress`).
- **Wired?:** Fully working.
- **Brand strings:** `<title>Learner Progressions — Pearl LMS</title>`; comments "PearlLMS".

#### Tutor Allocation — `/org/[slug]/allocation`
- **Roles:** UI = ADMIN (layout). API `requireManagerOrAdmin` (so a future Manager surface could reuse it). HIDDEN: nav gated by `LEGACY_ALLOCATION_NAV_ENABLED=false`; function folded into Tutor/Learner Management. Reachable by URL only.
- **Reached from:** URL only.
- **Purpose:** Pair tutors with learners (provider-wide pairs; applies to all that learner's courses).
- **UI & actions:** Heading "Tutor allocation", explainer text, button "Assign tutor"; toggle "By tutor" / "By learner" grouping; per group a table (Learner|Tutor, Email, Actions "Remove"). Assign dialog: Tutor select + Learner select (both required) -> "Assign". Remove confirm dialog. Empty "No allocations yet. Assign a tutor to get started."
- **API calls:** `GET /organization/allocations`, `GET /organization/allocations/assignable`, `POST /organization/allocations`, `DELETE /organization/allocations/:allocationId` (`apps/api/src/routes/organization/allocations.ts`, `services/organization/allocation.ts`). Files: `lib/features/allocation/{pages/allocation.svelte, api/allocation.svelte.ts}`; `routes/.../allocation/+page.svelte`.
- **Data:** tutor_allocation (R/W), organizationmember/profile (read), audit_event.
- **Wired?:** Working but superseded (hidden legacy). Note: the new Learner Management "New Learner" dialog requires a tutor and so writes allocations too; there is no other UI to change a learner's tutor afterwards besides this hidden page.
- **Brand strings:** `<title>Tutor allocation — Pearl LMS</title>`.

#### Users (legacy) — `/org/[slug]/users`
- **Roles:** ADMIN (layout + all API `requireAdmin`). HIDDEN: `LEGACY_USERS_NAV_ENABLED=false`. URL only.
- **Reached from:** URL only.
- **Purpose:** Generic user admin: create any-role user, change role, (de)activate, edit learner PII, "onboard learner". **This is the only UI that can create or promote a MANAGER** (`ROLE_OPTIONS` Admin/Manager/Tutor/Learner).
- **UI & actions:** Header buttons "Onboard learner", "Create user". Search (300 ms debounce). Table: Name, Email, Role, Status (Active/Deactivated), row menu = "Edit profile (PII)", "Change role", "Deactivate"/"Reactivate". Dialogs: Create user (name, email, role select), Onboard learner (name, email, published-course select; result dialog shows credentials, "Onboard another"), Change role (select, Save), confirm (de)activate, Learner profile (PII) form with fields Date of birth, NI number, Gender, Ethnicity, Disability, Address, AEB region, College ref, Notes. Pagination controls.
- **API calls:** `GET /organization/users?search&page...`; `POST /organization/users` `{name,email,roleId 1-4}`; `GET /organization/users/onboard/courses`; `POST /organization/users/onboard` `{name,email,courseId}`; `PUT /organization/users/:memberId/role`; `PUT /organization/users/:memberId/status`; `GET|PUT /organization/users/:memberId/profile` (admin-only PII; audit logs changed field names only). Files: `lib/features/users/{pages/users.svelte, api/users.svelte.ts}`, `apps/api/src/routes/organization/users.ts`, `packages/utils/src/validation/organization/users.ts`.
- **Data:** organizationmember, profile, user, learner_profile (PII, 1:1), groupmember (onboard enrol), audit_event.
- **Wired?:** Fully working; legacy-hidden. Keep it (or port Manager creation + PII editing elsewhere) when replicating, otherwise there is no UI to create managers or edit learner PII.
- **Brand strings:** `<title>Users — Pearl LMS</title>`.

#### Broadcasts — `/org/[slug]/broadcasts`
- **Roles:** ADMIN. Nav `requiresAdmin`; compose/manage endpoints `requireAdmin`; feed read `requireActor` with server-side scoping (learners/tutors see theirs elsewhere via `BroadcastBanner`).
- **Reached from:** sidebar People > Broadcasts.
- **Purpose:** Admin announcements to learners/tutors.
- **UI & actions:** Card "New broadcast": Title (max 200), Message (textarea max 5000), Send to select (All learners / All tutors / A course's learners / A specific learner / A tutor's learners) with conditional Course select, Tutor select (hint "Sends to every learner allocated to this tutor"), or Learner type-ahead (min 2 chars, 250 ms debounce). "Publish" enabled when title+body+target present. List "Sent broadcasts" (`AnnouncementsList` in manage mode): archive/unarchive, delete (confirm "Delete this broadcast for everyone? This cannot be undone."). Empty "No broadcasts sent yet."
- **API calls:** `GET /announcements`, `GET /announcements/courses`, `/tutors`, `/learners?search=`, `POST /announcements`, `POST /announcements/:id/archive`, `DELETE /announcements/:id` (`apps/api/src/routes/comms/announcements.ts`). Files: `lib/features/announcements/{api/announcements.svelte.ts, components/announcements-list.svelte, components/broadcast-banner.svelte}`.
- **Data:** announcement (R/W); reads course, organizationmember/profile, tutor_allocation, groupmember to resolve audience; notification rows possibly created.
- **Wired?:** Working. Publish-immediate only (no scheduling).
- **Brand strings:** `<title>Broadcasts</title>`; the dismiss store key `pearl.dismissedBroadcasts` (localStorage) in `broadcast-banner.svelte`.

#### Courses — `/org/[slug]/courses`
- **Roles:** ADMIN (layout). In nav, no flag. List API `GET /organization/courses` uses `authOrAutomationKeyMiddleware` + `orgMemberOrAutomationKeyMiddleware(['course:read'])`; create `POST /course` is `requireAdmin`.
- **Reached from:** sidebar Content > Courses; root-page button; setup page.
- **Purpose:** Org course catalogue (admin) and entry to the course builder at `/courses/[id]`.
- **UI & actions:** Header (`courses.heading`/`page_subtitle`) + "New course" button (`CreateCourseButton`, disabled if not `isOrgAdmin`, navigates to `?create=true`). `NewCourseModal` (opens on `?create=true`): step 1 type cards (Self-paced, Live class, Compliance, Public), step 2 Course name (required) + Short description (required, with AI-assist flag `isAIEnabled`). Creates via `courseApi.create` then goes into the course. List: search, grid/list toggle (localStorage `courseView`), filter popover (sort by date created / last updated / published / lessons, order, course type, tag filter by tag groups), URL params `tags`, `sort`, `order`, `type`; sort persisted in localStorage keys `classroomio_filter_course_sort_key` / `..._order_key`. Card dropdown: view course site, copy course URL, view as student, open, publish, clone (copy-course modal), share, invite, delete. Empty state with create button.
- **API calls:** `GET /organization/courses?tags=`, `GET /organization/tags`, `POST /course`, plus course endpoints for clone/delete/publish. Files: `routes/.../courses/{+page.svelte,+page.server.ts}`, `lib/features/course/{pages/courses.svelte, components/{new-course-modal, create-course-button, course-filter-popover, card-dropdown, course-context-menu-content, copy-course-modal}.svelte, api/courses.svelte.ts}`.
- **Data:** course, lesson (counts), tag/tag_assignment (filters), group/groupmember on create.
- **Wired?:** Fully working (core upstream screen). Share/invite menu items are upstream and may point to flows not meaningful in a closed system. Tag filter shows only if tag groups exist.
- **Brand strings:** `<title>Courses - Integer Training LMS</title>`; localStorage keys prefixed `classroomio_`.

#### Media — `/org/[slug]/media`
- **Roles:** ADMIN (layout). In nav, no flag. API list/get/usage are `orgMemberMiddleware`; `POST /` create, `PUT /:id`, thumbnail `requireAdmin`; delete, export, transcript PUT `orgAdminMiddleware`.
- **Reached from:** sidebar Content > Media.
- **Purpose:** Media library manager for assets (videos/docs/images/audio) used in lessons.
- **UI & actions:** Header (`media_manager.heading`/`page_subtitle`). Storage summary cards. View toggle "By course" (grouped, with "unassigned") / "All". Filter bar: kind tabs (all, video, document, image, audio, other), search, status select (all/active/archived), Apply, refresh. Asset cards: Edit (file name, description, thumbnail upload, status active/archived), Manage thumbnails (HLS-generated or custom upload, regenerate), Where used (usage dialog, attach/detach), Download, Delete (warns if in use). Pagination Previous/Next (limit up to 100). **No "upload" button on this page**; uploads happen from the lesson editor.
- **API calls:** `GET /organization/assets` (query page,limit,kind,status,search,includeExternal), `/assets/grouped`, `/assets/storage`, `/assets/youtube-metadata`, `POST /assets`, `PUT /assets/:id`, `GET /assets/:id/usage`, `POST /assets/:id/attach|detach`, `DELETE /assets/:id`, transcript GET/PUT, `PUT /assets/:id/thumbnail`, `POST /jobs/media/asset/:id/regenerate-thumbnail`, `POST /jobs/media/asset/:id/transcribe`, `POST /assets/:id/hls/cookie`, HLS routes `/hls/:assetId/*`. Files: `routes/.../media/{+page.svelte,+page.server.ts}`, `lib/features/media/**`, `apps/api/src/routes/organization/assets.ts`.
- **Data:** assets, asset_usages, media_job, job_step, media_transcript, video_transcripts; object storage (Supabase Storage via S3 API in prod).
- **Wired?:** Working; transcription is OpenAI-Whisper dependent (key-gated). Known upstream bug: jobs worker `ffmpegProbeLuma` export (CODEMAP s8) breaks thumbnail/media workers.
- **Brand strings:** `<title>` from `media_manager.page_title`. None hardcoded.

#### Community — `/org/[slug]/community`
- **Roles:** ADMIN via layout; API `orgMemberMiddleware` + `requireSameOrg`. In nav (People > Community, always shown to admins; `COMMUNITY_ENABLED` only hides the learner-side one).
- **Reached from:** sidebar People > Community.
- **Purpose:** Q&A forum feed for the org (upstream ClassroomIO feature).
- **UI & actions:** Header + "Ask" button (`AskCommunityButton`). Search ("find question"), course filter select (All / course), list of question cards (votes, comments count), empty state "no question / ask a question".
- **API calls:** `GET /community?orgId=` (SSR), `GET /community/:slug`, `POST /community`, `PUT /community/:id`, `DELETE /community/:id`, `POST /community/:id/comment`, `POST /community/:id/upvote`, delete comment routes (`apps/api/src/routes/community/community.ts`). Files: `routes/.../community/{+page.svelte,+page.server.ts}`, `lib/features/community/**`.
- **Data:** community_question, community_answer, course (filter list).
- **Wired?:** Working upstream code; learner-side community is switched off (`COMMUNITY_ENABLED=false`), so only admins see/use it and the feed is probably empty. Candidate to hide in the new brand.
- **Brand strings:** `<title>Community - Integer Training LMS</title>`.

#### Community question — `/org/[slug]/community/[cslug]`
- **Roles:** ADMIN via layout; API `GET /community/:slug` `orgMemberMiddleware`; edit/delete via `questionAuthorOrTeamMiddleware`.
- **Reached from:** a question card on Community.
- **Purpose:** View a question, answer, upvote, edit/delete.
- **UI & actions:** `CommunityQuestionPage`: question title/body, rich-text comment box, upvote, comment list with author-or-admin delete, edit/delete question (delete modal), back link.
- **API calls:** `GET /community/:slug` (SSR load), then the comment/upvote/delete routes above. Files: `routes/.../community/[cslug]/{+page.svelte,+page.server.ts}`, `lib/features/community/pages/community-question.svelte`.
- **Data:** community_question, community_answer, upvote data on the question.
- **Wired?:** Working.
- **Brand strings:** `<title>Question - Integer Training LMS</title>`.

#### Ask the community — `/org/[slug]/community/ask`
- **Roles:** ADMIN via layout; API `POST /community` `orgMemberMiddleware`.
- **Reached from:** "Ask" button on Community (nav `nestedRoutes` entry "Ask Question").
- **Purpose:** Post a new question.
- **UI & actions:** Title input, course select (required), TipTap `TextEditor` body, "Publish" button. Inline validation errors from `communityApi.errors` (title, courseId, body). Back button.
- **API calls:** `POST /community`; course list via `fetchCoursesForOrg`. Files: `routes/.../community/ask/+page.svelte` (no server load), `lib/features/community/pages/ask-community.svelte`.
- **Data:** community_question.
- **Wired?:** Working. Editor placeholder says "Give an answer" (copy bug, hardcoded).
- **Brand strings:** `<title>Ask the Community - Integer Training LMS</title>`.

#### Cohorts — `/org/[slug]/cohorts`
- **Roles:** ADMIN (layout). HIDDEN: nav gated by `COHORTS_ENABLED=false`. API `GET /cohort` and `POST /cohort` are `requireAdmin` + `requireSameOrg`.
- **Reached from:** URL only.
- **Purpose:** Upstream cohorts (group of people with access to multiple courses). Unused: apprentices are enrolled by staff allocation.
- **UI & actions:** Header "Cohorts" + "New Cohort". Search, filter popover (status Active/Inactive/Archived; sort name/courses/students/status), cards; empty state "No cohorts yet". `CreateCohortModal`: Name (required, placeholder "e.g. OSHA Safety Certification"), Description. Cards link to `/cohorts/[id]/*` (outside scope).
- **API calls:** `GET /cohort?organizationId=`, `POST /cohort`. Files: `routes/.../cohorts/{+page.svelte,+page.server.ts}`, `lib/features/cohort/**`, `apps/api/src/routes/cohort/cohort.ts`.
- **Data:** cohort, cohort_course, cohort_member (+ cohort_newsfeed, cohort_goal* downstream).
- **Wired?:** Working upstream code, dormant. (Legacy `program*` tables still in schema.)
- **Brand strings:** `<title>Cohorts - Integer Training LMS</title>`.

#### Teams / Goals overview — `/org/[slug]/teams-overview`
- **Roles:** ADMIN via layout. API `GET /cohort/goals/overview` is `orgTeamMemberMiddleware` (admin or tutor). No nav entry, no inbound links found. HIDDEN/ORPHAN.
- **Reached from:** URL only.
- **Purpose:** Cross-cohort goals dashboard: per cohort, per goal on-track/at-risk/overdue counts.
- **UI & actions:** Per-cohort card (link to `/cohorts/{id}/settings`), aggregate on-track %, learners, at-risk, overdue; table Goal, Type badge, Completed x/y, In progress, At risk, Overdue, On track %. Empty state "cohorts.goals.empty_*".
- **API calls:** `GET /cohort/goals/overview?organizationId=` (client-side `cohortGoalApi.listOverview`). Files: `routes/.../teams-overview/+page.svelte`, `lib/features/cohort/api/*goal*`.
- **Data:** cohort, cohort_goal, cohort_goal_assignment, cohort_member.
- **Wired?:** Working code but depends on cohorts being used; dead in practice.
- **Brand strings:** `<title>... · Integer Training LMS</title>`.

#### Audience — `/org/[slug]/audience`
- **Roles:** ADMIN (layout). HIDDEN: `AUDIENCE_NAV_ENABLED=false` (replaced by Learner Management). API `GET /organization/audience` `requireAdmin`; delete member `orgAdminMiddleware`.
- **Reached from:** URL only.
- **Purpose:** Upstream student list with invite status, plan seat count, assign courses, import.
- **UI & actions:** Title with `(n / max)` seat counter unless plan is ENTERPRISE. Buttons "Export" (**stub: `alert('This feature is coming soon')`**) and "Import users" (disabled with tooltip at student limit `currentOrgMaxAudience`). Toolbar: search, selected-count + "Assign courses" modal. Table columns name, email, status (+ courses); row menu Resend invite / Revoke invite / Delete (confirmation). Server pagination/query params parsed by `getAudienceQueryFromSearchParams`.
- **API calls:** `GET /organization/audience` (SSR), `GET /organization/courses`, `POST /organization/audience/assign-courses`, `POST /organization/audience/resend-invite`, `POST /organization/audience/revoke-invite`, `DELETE /organization/audience/:memberId` (`apps/api/src/routes/organization/organization.ts`). Files: `routes/.../audience/{+page.svelte,+page.server.ts}`, `lib/features/audience/{pages,components}/**`, `lib/features/org/api/org.svelte.ts`.
- **Data:** organizationmember, profile, organization_invite (+audit), groupmember.
- **Wired?:** Mostly working but superseded; Export is a stub; invite emails depend on email infra (dormant). Closed system provisions accounts, so invite flows are largely irrelevant.
- **Brand strings:** `<title>Audience - Integer Training LMS</title>`.

#### Audience import — `/org/[slug]/audience/import`
- **Roles:** ADMIN via layout; `POST /organization/audience/import` `requireAdmin`. Hidden (button on Audience page only; blocked at seat limit).
- **Reached from:** "Import users" on Audience.
- **Purpose:** Bulk-invite students by email with optional course/cohort access.
- **UI & actions:** Back button, Submit button (form id `import-audience-form`). Form: Emails textarea (`audience.import.emails_label`), Course access radio (none / all / select -> multiselect), Cohort access radio (none / all / select -> multiselect). "send-email" checkbox is commented out in code.
- **API calls:** `POST /organization/audience/import`; SSR loads `GET /organization/courses` and `GET /cohort?organizationId=`. Files: `routes/.../audience/import/*`, `lib/features/audience/pages/import.svelte`.
- **Data:** organization_invite, organizationmember, profile, groupmember, cohort_member.
- **Wired?:** Working upstream code; dormant. Creates invites rather than accounts, which conflicts with the closed provision-only model (ACCESS.md 1.2).
- **Brand strings:** `<title>... - Integer Training LMS</title>`.

#### Audience user analytics — `/org/[slug]/audience/[...params]`
- **Roles:** ADMIN via layout; `GET /organization/audience/:userId/analytics` `requireAdmin`. Hidden (catch-all; first segment = userId).
- **Reached from:** Audience row link.
- **Purpose:** Per-student analytics page.
- **UI & actions:** `HeroProfileCard`, stat cards (Enrolled courses, Overall course progress, Total average grade), `ActivityCard`, per-course list with progress bar and complete/incomplete badge. Back to Audience.
- **API calls:** `GET /organization/audience/:userId/analytics` (SSR). Files: `routes/.../audience/[...params]/*`, `lib/features/audience/pages/user-analytics.svelte`.
- **Data:** profile, groupmember, lesson_completion, submissions/grades, analytics events.
- **Wired?:** Working; falls back to `/images/classroomio-course-img-template.jpg` for missing course logos (upstream asset).
- **Brand strings:** `<title>... - Integer Training LMS</title>`; image `classroomio-course-img-template.jpg`.

#### Analytics — `/org/[slug]/analytics`
- **Roles:** ADMIN via layout. HIDDEN (no nav item; nav comment: "stock marketing Analytics + Compliance pages are hidden (no data source in a closed provider)"). API `requireManagerOrAdmin` + `requireSameOrg`.
- **Reached from:** URL only.
- **Purpose:** Upstream landing-page/course-funnel traffic analytics.
- **UI & actions:** Range picker (7/30/90 days) + Refresh. `LandingKpis`, tabs Overview / Funnel / Geography / Course types with `TrendChart`, `Funnel`, `PopularTypes`, `CountriesTable`.
- **API calls:** `GET /dash/landing-stats`, `/dash/country-breakdown`, `/dash/course-funnel`, `/dash/popular-types` (`apps/api/src/routes/dash/stats.ts`); client `lib/features/analytics/api/analytics.svelte.ts`. Page: `routes/.../analytics/+page.svelte`.
- **Data:** analytics_page_event, analytics_org_daily, analytics_course_daily, analytics_country_daily (fed by `POST /dash/track` + daily rollup job).
- **Wired?:** Functional code but meaningless in this deployment (no public landing site, so tables are near-empty). Treat as upstream leftover.
- **Brand strings:** `<title>{analytics.title} - Integer Training LMS</title>`.

#### Compliance — `/org/[slug]/compliance`
- **Roles:** ADMIN via layout. HIDDEN (no nav item). API `GET /dash/compliance-overview` `requireManagerOrAdmin` + `requireSameOrg`.
- **Reached from:** URL only.
- **Purpose:** Upstream compliance-certification tracking across COMPLIANCE-type courses.
- **UI & actions:** Refresh button; `StatusTiles`; tabs "By course" (`CourseBreakdown`) and "Students" (`LearnersTable`: learner, course, status, due date, expires) with status filter chips (all, compliant, expiring_soon, in_grace_period, non_compliant, in_progress, not_started, waived, no_record).
- **API calls:** `GET /dash/compliance-overview?orgId=` -> `getOrgComplianceOverview` in `apps/api/src/services/course/compliance.ts`. Files: `routes/.../compliance/+page.svelte`, `lib/features/compliance/**`.
- **Data:** course (type COMPLIANCE), groupmember, course_completion_record, notification events.
- **Wired?:** Working only if COMPLIANCE-type courses are used; otherwise empty. Upstream leftover for the apprenticeship model.
- **Brand strings:** `<title>{compliance.title} - Integer Training LMS</title>`.

#### Quiz list (Interactive Quizzes) — `/org/[slug]/quiz`
- **Roles:** ADMIN via layout. HIDDEN: no nav, no inbound link anywhere. API `/organization/:orgId/quiz` uses `orgMemberMiddleware` + `requireSameOrg({param:'orgId'})` (any org member could call it).
- **Reached from:** URL only.
- **Purpose:** Upstream Kahoot-style "interactive quizzes".
- **UI & actions:** `<h1>` "Interactive Quizzes", "Create Quiz" button (icon on mobile), `NewQuizModal` (title; create/rename), `DeleteModal`, `Quizzes` grid of `QuizCard` (title link to `/quiz/{id}`).
- **API calls:** `GET|POST /organization/:orgId/quiz`, `PUT|DELETE /organization/:orgId/quiz/:quizId` via `lib/features/org/api/quiz.svelte.ts`. Files: `routes/.../quiz/+page.svelte`, `lib/features/org/components/quiz/*`.
- **Data:** quiz (questions JSON, theme, timelimit), quiz_play.
- **Wired?:** CRUD works; hardcoded English; the "play" side is **dead/external**: `components/quiz/play/connect-to-play.svelte` shows `play.classroomio.com`, a vendor-hosted service. Orphan feature.
- **Brand strings:** `<title>Interactive Quizzes - Integer Training LMS</title>`; `play.classroomio.com`.

#### Quiz editor — `/org/[slug]/quiz/[slug]`
- **Roles:** ADMIN via layout; same orphaned/hidden status as above.
- **Reached from:** a quiz card, or redirect after `NewQuizModal` creates a quiz.
- **Purpose:** Edit quiz questions/options/time limit/theme.
- **UI & actions:** Left rail question list (+ "Add Question"), centre editor (`QuizQuestion`, "Add more"/"Remove last" options up to `allOptions.length`, validation: label required, at least one correct answer), right settings: "Save Changes", "Preview Quiz", "Delete question", Question type (Multi-choice / True or False), Time limit (10s..3m), theme picker (`allThemes`).
- **API calls:** `GET /organization/:orgId/quiz/:quizId`, `PUT .../quiz/:quizId` via `quizApi`. Files: `routes/.../quiz/[slug]/{+page.svelte,+page.ts}` (`+page.ts` just passes `quizId = params.slug`).
- **Data:** quiz.
- **Wired?:** Editor works; play/host unavailable (see above).
- **Brand strings:** none on page; theme images from upstream constants.

#### Tags — `/org/[slug]/tags`
- **Roles:** ADMIN via layout. HIDDEN: `TAGS_ENABLED=false` (nav also `requiresAdmin`). Server load redirects to `/org/{slug}` on API 401/403. API: `GET /organization/tags` `orgMemberMiddleware`; create/update `orgAdminMiddleware`.
- **Reached from:** URL only. Tags are still used as a course filter on Courses if groups exist.
- **Purpose:** Manage tag groups and tags used to categorise courses.
- **UI & actions:** Header + split button "Create tag" / menu "Create tag group". Table grouped by category: Tag, Total courses (link to `/courses?tags=slug`), Description, Category, Action menu (edit tag / edit group). Group modal (Name, Description), tag modal (Name, Description, Category select, Color). Empty state with "Create group" (create-tag disabled until a group exists).
- **API calls:** `GET /organization/tags`, `POST /organization/tags/groups`, `PUT /organization/tags/groups/:groupId`, `POST /organization/tags`, `PUT /organization/tags/:tagId`; course tag routes `GET|PUT /course/:courseId/tags`. Files: `routes/.../tags/*`, `lib/features/tag/{pages/tags-admin.svelte, api/tag.svelte.ts}`, `apps/api/src/routes/organization/tags.ts`.
- **Data:** tag_group, tag, tag_assignment.
- **Wired?:** Working; dormant.
- **Brand strings:** page title from `tags_admin.page_title`. None hardcoded.

#### Widgets — `/org/[slug]/widgets`
- **Roles:** ADMIN via layout. HIDDEN: `WIDGETS_ENABLED=false`. Server load redirects to `/org/{slug}` on 401/403. API list/create/update `orgTeamMemberMiddleware`; delete/publish/rollback `orgAdminMiddleware`.
- **Reached from:** URL only. Nav match pattern also covers the editor `/widgets/[id]` (outside `org/[slug]`).
- **Purpose:** Embeddable course widgets (iframe/embed) for external sites.
- **UI & actions:** Header + "Create widget"; widget cards (name, course count, status, Edit/dropdown); create dialog with Name -> creates `card_grid`/manual widget and goes to `/widgets/{id}` editor. Empty state.
- **API calls:** `GET|POST /organization/widgets`, `/:widgetId` GET/PUT/DELETE, `POST /:widgetId/publish`, `POST /:widgetId/rollback` (`apps/api/src/routes/organization/widgets.ts`). Files: `routes/.../widgets/*`, `lib/features/widget/**`. Embeds served by `apps/embeds`.
- **Data:** widget, widget_course, widget_version.
- **Wired?:** Working upstream; irrelevant to a private LMS.
- **Brand strings:** `<title>{widgets.heading} - Integer Training LMS</title>`.

#### MCP — `/org/[slug]/mcp`
- **Roles:** ADMIN via layout; HIDDEN: nav gated by `AI_ENABLED=false` (also `requiresAdmin`/`disableWhenNotAdmin`). API `/organization/automation/*` = `authMiddleware` + `orgAdminMiddleware`. `/org/[slug]/automation` redirects (307) here.
- **Reached from:** URL, or `/automation` redirect.
- **Purpose:** Generate MCP keys so AI clients (Cursor, Claude Code, Codex, OpenCode) can author courses through the published `@classroomio/mcp` package.
- **UI & actions:** Usage cards (monthly credits remaining/used, active keys vs `maxActiveKeys`, rate limits read/write per minute), keys table (Key masked prefix, Status Active/Revoked, Created, Last used, row menu Rotate / Revoke with `confirm()`), generate-key modal (name), one-time secret display with copy, client setup tabs (Cursor / Claude Code / Codex / OpenCode) with generated config snippets. Empty state.
- **API calls:** `GET /organization/automation/keys?type=mcp`, `GET /organization/automation/usage?type=mcp`, `POST /organization/automation/keys`, `DELETE /organization/automation/keys/:keyId`, `POST /organization/automation/keys/:keyId/rotate`. Files: `routes/.../mcp/*`, `lib/features/automation/{pages/mcp.svelte, api/automation.svelte.ts, utils/automation-utils.ts}`, `apps/api/src/routes/organization/automation.ts`.
- **Data:** organization_api_key, organization_automation_usage.
- **Wired?:** UI/keys work, but generated config **points at the vendor**: `CLASSROOMIO_API_URL=https://api.classroomio.com`, command `npx -y @classroomio/mcp`, server name `classroomio`. It would not target this deployment without edits. Upstream leftover while AI is disabled.
- **Brand strings:** `automation-utils.ts` (lines ~7, 102-150: `@classroomio/mcp`, `classroomio`, `CLASSROOMIO_API_URL`, `CLASSROOMIO_API_KEY`, `api.classroomio.com`); `<title>... - Integer Training LMS</title>`.

#### API keys — `/org/[slug]/api`
- **Roles:** ADMIN via layout; HIDDEN: `API_ACCESS_ENABLED=false`. Server load fetches keys `GET /organization/automation/keys?type=api` (`orgAdminMiddleware`). Shows an `UpgradeBanner` if `hasPublicApiAccess` store is false, and a disabled-permission alert for non-admins.
- **Reached from:** URL only.
- **Purpose:** Manage keys for the public REST API (`/v1`).
- **UI & actions:** "View docs" button -> `window.open('https://classroomio.com/docs/api')`; keys table with generate/rotate/revoke, same as MCP; one-time secret box with copy.
- **API calls:** `GET|POST /organization/automation/keys`, `DELETE`, `POST .../rotate`. Files: `routes/.../api/{+page.svelte,+page.server.ts}`, `lib/features/automation/pages/api.svelte`.
- **Data:** organization_api_key.
- **Wired?:** Working keys; docs link goes to the vendor; REST surface is `apps/api/src/routes/v1`.
- **Brand strings:** `https://classroomio.com/docs/api`; `<title>... - Integer Training LMS</title>`.

#### Zapier — `/org/[slug]/zapier`
- **Roles:** ADMIN via layout; HIDDEN: `ZAPIER_ENABLED=false`.
- **Reached from:** URL only.
- **Purpose:** Placeholder for a Zapier integration.
- **UI & actions:** Only an information callout with `automation.coming_soon`.
- **API calls:** none. File: `routes/.../zapier/+page.svelte` + `lib/features/automation/pages/zapier.svelte`.
- **Data:** none.
- **Wired?:** **Stub** ("coming soon").
- **Brand strings:** `automation-utils.ts` returns 'Integer Training LMS Zapier'; title suffix "Integer Training LMS".

#### Setup / Get started — `/org/[slug]/setup`
- **Roles:** ADMIN via layout (the underlying `GET /organization/setup?siteName=` has **no auth middleware**; it is publicly callable by siteName). HIDDEN: removed from nav ("hidden - not needed for a live provider"); only reached by URL.
- **Reached from:** URL only (the welcome modal / org-home flows referenced it upstream).
- **Purpose:** Upstream onboarding checklist.
- **UI & actions:** Progress dots "n of m completed"; checklist items: Update profile, Update organization profile, Create course, Create lesson, Create exercise, Publish course. Each "To do" button deep-links (settings, settings/org, `courses?create=true`, `/courses/{id}/lessons`, `/courses/{id}/lessons/{lessonId}`, course settings publish section via `goAndHighlight`); done items show "Done".
- **API calls:** `GET /organization/setup?siteName=` (SSR) -> `getOrgSetupData`. Files: `routes/.../setup/{+page.svelte,+page.server.ts}`, `lib/features/setup/**`.
- **Data:** read organization, course, lesson, exercise.
- **Wired?:** Works but unused. Contains stray `console.log('data', ...)` calls. The unauthenticated `/organization/setup` endpoint exposes course/lesson/exercise data for a given siteName.
- **Brand strings:** `<title>Setup - Integer Training LMS</title>`.

#### Reports > Learners — `/org/[slug]/reports/learners`
- **Roles:** Page server `requireManagerOrAdmin`, but the parent org layout is ADMIN-only so only ADMIN reaches it (managers use `/reports`). Nav sub-item, no `requiresAdmin`. API `GET /dash/reports/learners` `requireManagerOrAdmin`.
- **Reached from:** sidebar Reports > Learners.
- **Purpose:** Learner progression report.
- **UI & actions:** KPIs (Total learners, Active <=30 days, Inactive 30+ days idle, New this month, Avg progress); "Progress distribution" bar list; "Assessment throughput" bar list; "At-risk learners" table (Name, Progress, Started) with "Export" CSV; empty "No at-risk learners".
- **API calls:** `GET /dash/reports/learners` (`reportsApi.loadLearners`). Files: `routes/.../reports/learners/{+page.svelte,+page.server.ts}`, `lib/features/reports/{pages/learners-report.svelte, api/reports.svelte.ts, components/{report-kpi,bar-list}.svelte}`, service `apps/api/src/services/dash/reports.ts`.
- **Data:** organizationmember, profile, groupmember, analytics/login, lesson completion, coursework_*.
- **Wired?:** Working.
- **Brand strings:** none.

#### Reports > Courses — `/org/[slug]/reports/courses`
- **Roles:** same as Reports > Learners (`requireManagerOrAdmin` in page server; effectively ADMIN). Reuses `GET /dash/admin-overview`.
- **Reached from:** sidebar Reports > Courses.
- **Purpose:** Enrolment, activity, completion by course.
- **UI & actions:** KPIs (Active courses, Total courses, Total enrolled, Avg completion); "Enrolments this year" monthly bar; "By course" table (Course, Status, Enrolled, Active 30d, Assessments, Completion) + export CSV; empty "No courses yet."
- **API calls:** `GET /dash/admin-overview?orgId=` (shared bundle via `adminDashboardApi.loadOverview`). Files: `routes/.../reports/courses/*`, `lib/features/reports/pages/courses-report.svelte`.
- **Data:** as Dashboard.
- **Wired?:** Working.
- **Brand strings:** none.

#### Reports > Marking — `/org/[slug]/reports/marking`
- **Roles:** same pattern. Reuses `GET /dash/admin-overview`.
- **Reached from:** sidebar Reports > Marking.
- **Purpose:** Coursework throughput, backlog, SLA, turnaround, outcomes, tutor performance.
- **UI & actions:** KPIs (Awaiting marking + due soon, Overdue + SLA breach %, Draft feedback, Avg turnaround, a pass-rate tile, Resubmissions); "Outcomes" (Pass vs Refer bars); "Submissions this year"; "Tutor performance" table (Tutor, Learners, Awaiting, Inactive, Turnaround, Pass rate) + export CSV; empty "No tutors yet."
- **API calls:** `GET /dash/admin-overview`. Files: `routes/.../reports/marking/*`, `lib/features/reports/pages/marking-report.svelte`.
- **Data:** coursework_submission, coursework_result, tutor_allocation.
- **Wired?:** Working. Grading scale is Pass/Refer (apprenticeship model).
- **Brand strings:** none.

#### Reports > Completions — `/org/[slug]/reports/completions`
- **Roles:** same pattern. API `GET /dash/reports/completions` `requireManagerOrAdmin`.
- **Reached from:** sidebar Reports > Completions.
- **Purpose:** Completions and certificates.
- **UI & actions:** KPIs (Total completions, Completed this month, Certificates earned, Avg time to complete); "Completions this year" trend; "By course" table (Course, Enrolled, Completed, Completion, Avg days) + export CSV.
- **API calls:** `GET /dash/reports/completions`. Files: `routes/.../reports/completions/*`, `lib/features/reports/pages/completions-report.svelte`.
- **Data:** course_completion, course_completion_record, course_certificate_issue, groupmember.
- **Wired?:** Working.
- **Brand strings:** none.

#### Reports > Referrals — `/org/[slug]/reports/referrals`
- **Roles:** ADMIN. Nav sub-item `requiresAdmin`; API `requireAdmin`; page body also `{#if $isOrgAdmin}` (no `+page.server.ts`, so only the layout guard on the server).
- **Reached from:** sidebar Reports > Referrals.
- **Purpose:** Failing/"Refer" analysis: per-tutor strictness, per-learner seriousness.
- **UI & actions:** KPIs (Total refers all-time incl. resubmissions, Learners referred, a refer-rate tile, Tutors issuing refers); "Refers by tutor" bars; "Per tutor" table (Tutor, Learners referred, Total refers, Total graded, Refer rate) with export; "Per learner" table (Learner, Times referred, Units referred, Currently open, Last referred by, Last referred) with export. Non-admin message if `isOrgAdmin === false`.
- **API calls:** `GET /dash/reports/referrals`. Files: `routes/.../reports/referrals/+page.svelte`, `lib/features/reports/pages/referrals-report.svelte`; service `apps/api/src/services/dash/reports.ts` (test `apps/api/src/__tests__/dash/referrals-report.test.ts`).
- **Data:** coursework_result (+ submission), profile, tutor_allocation.
- **Wired?:** Working.
- **Brand strings:** none.

#### Reports > Tutor feedback — `/org/[slug]/reports/tutor-feedback`
- **Roles:** ADMIN (nav `requiresAdmin`, API `requireAdmin`, `{#if $isOrgAdmin}`).
- **Reached from:** sidebar Reports > Tutor feedback.
- **Purpose:** Learner->tutor ratings gathered by the every-N-units popup.
- **UI & actions:** KPIs (Feedback received, Average overall /5, Tutors rated, Learners responded); "Average overall rating by tutor" bars; "Per tutor" table (Tutor, Responses, Overall, Communication, Helpfulness, Knowledge) with export; "All responses" table (Date, Learner, Tutor, Unit, Overall, Comm., Help., Know., Comment) with export.
- **API calls:** `GET /dash/reports/tutor-feedback`. Files: `routes/.../reports/tutor-feedback/+page.svelte`, `lib/features/reports/pages/tutor-feedback-report.svelte`; submit side `apps/api/src/services/lms/tutor-feedback.ts`.
- **Data:** tutor_feedback, profile, tutor_allocation.
- **Wired?:** Working (needs learner-side popup to have produced data).
- **Brand strings:** none.

#### Reports > Activity log — `/org/[slug]/reports/activity-log`
- **Roles:** ADMIN (nav `requiresAdmin`, API `requireAdmin`, `{#if $isOrgAdmin}`).
- **Reached from:** sidebar Reports > Activity log.
- **Purpose:** Viewer for `system_event_log`: logins, logouts, API/client errors.
- **UI & actions:** KPIs (Total events matching filters, Errors last 24h, Failed logins last 24h); filter form: From, To (dates, `to` inclusive), Event type (auth.login.success, auth.login.failure, auth.logout, auth.session_invalid_bounce, api.error, client.error), Severity (info/warn/error), HTTP status, user email contains; Apply/Reset; table (Time UTC, Event type, Severity, User email, IP masked, Path, Status, Message) + export CSV.
- **API calls:** `GET /dash/reports/activity-log` (query filters). Files: `routes/.../reports/activity-log/+page.svelte`, `lib/features/reports/pages/activity-log-report.svelte`, `apps/api/src/services/dash/system-events.ts`.
- **Data:** system_event_log.
- **Wired?:** Working.
- **Brand strings:** none.

---

### 3. Extra route found in scope folder

#### Automation redirect — `/org/[slug]/automation`
- **Roles:** ADMIN via layout; no UI. **Reached from:** old links. **Purpose:** `+page.ts` throws `redirect(307, /org/{slug}/mcp{search})`. **API/Data:** none. **Wired?:** redirect only; target `/mcp` is itself hidden by `AI_ENABLED`. **Brand strings:** none. File: `routes/.../automation/+page.ts`.

### 4. Surprises and replication notes

1. The org layout is ADMIN-only, so per-page `requireManagerOrAdmin` on `/org/[slug]/reports/*` and nav-level managers' access are moot; MANAGER cannot open any `/org/[slug]/...` URL. Managers rely on `/reports` and a few other top-level routes (not in this scope).
2. Only the hidden **Users** page can create/promote a MANAGER or edit learner PII (`learner_profile`). Replicating "Gecko Programmes" must keep it reachable (or move those functions).
3. Hidden/orphan/dead: Home root (AI branch dead), Analytics, Compliance, Teams-overview, Quiz (+ editor; play host is vendor `play.classroomio.com`), Setup, Zapier (stub "coming soon"), Cohorts, Tags, Widgets, Audience (+import, +analytics; Export is `alert('coming soon')`), Allocation, Users, MCP, API.
4. Vendor leftovers that would break or mislead in a new brand: MCP config snippets use `https://api.classroomio.com`, `@classroomio/mcp`; API page links to `https://classroomio.com/docs/api`; quiz play host `play.classroomio.com`; localStorage keys `classroomio_filter_course_*`; image `/images/classroomio-course-img-template.jpg`; en.json already says "Integer Training LMS" in place of ClassroomIO.
5. `GET /organization/setup?siteName=` has no auth middleware.
6. Credentials are delivered by on-screen reveal of a generated temporary password (email delivery "dormant"); all create/reset flows depend on `RevealPanel`.
7. Newer screens hardcode English (no i18n); only `<title>` strings contain "Pearl LMS" (allocation, users, learner progressions, admin dashboard) or "Integer Training LMS" (older screens); `broadcast-banner.svelte` uses localStorage key `pearl.dismissedBroadcasts`.
8. Admin creation is super-admin only (earliest admin, derived server-side).
9. Tutor Management CSV header says "Caseloads" where the column is "Courses".


## 11 — Admin screens B (settings, cohorts, shared top-level routes, app shell)

Scope: `apps/dashboard/src/routes/(app)/` — `org/[slug]/settings/**`, `cohorts/[id]/*`, `announcements`, `registrations`, `reports`, `home`, `welcome`, `widget-preview`, `widgets/[widgetId]`, `messages`, `messages/[threadId]`, `change-password`, plus the `(app)` and `org/[slug]` layouts.
Read-only inventory. Source-of-truth feature flags: `apps/dashboard/src/lib/utils/constants/features.ts`. Feature modules live in `apps/dashboard/src/lib/features/*`. Self-hosted = `PUBLIC_IS_SELFHOSTED=true` (PearlLMS prod).

Legend: "API" below is the Hono app in `apps/api/src`; the dashboard talks to it through the typed RPC client `classroomio` (`apps/dashboard/src/lib/utils/services/api`) via the `/proxy` hop. Guards named `orgAdminMiddleware` / `requireAdmin` etc. are in `apps/api/src/middlewares/`.

---

### App shell & role routing

#### 1. Request pipeline before any (app) route renders
- `apps/dashboard/src/hooks.server.ts`
  - `/proxy/*` and `/api/auth/*` are forwarded to the API (`proxyRequestToApi`).
  - Everything else: `getSessionData(cookies)` -> `event.locals` (`user`, `profile`, `actor`, `orgRoles`). Anonymous (no user and no `classroomio*` cookie) on a non-public path -> 303 `/login?redirect=<path>`.
  - Public paths (regexes in `lib/utils/constants/routes.ts` `PUBLIC_ROUTES`): `/login`, `/logout`, `/signup`(redirects to login), `/invite/*`, `/forgot`, `/reset`, `/pages/*`, `/course/<x>[/enroll]`, `/course/<x>/lesson/*`, `/courses`, `/404`, `/verify-email-error`, auth-failed, `/csp-report`. **`/` is NOT public.** `/widget-preview` is NOT public (needs login).
  - Adds security headers, no-cache on HTML, sets `cio_aid` analytics cookie, `handleError` posts to API `/log/client` with a correlation id.
- `routes/+layout.server.ts` (root): `getOrgSiteInfo(url,cookies)` (subdomain -> org-site detection), base meta tags, `serverLang`, `localeCookie`, `locals`, `uploadLimits`; `skipAuth` when subdomain `play` or cookie `debugPlay=true`. `routes/+layout.ts` loads translations (cookie `classroomio_locale` > profile.locale > accept-language > `en`).
- `routes/+page.server.ts` (`/`): authenticated -> 303 `homeForRole(role, siteName)`; anonymous -> 303 `/login`. No public landing page exists.

#### 2. `homeForRole` — single source of truth for role landing
`lib/utils/functions/routes/homeForRole.ts`:

| Role (roleId) | Home |
|---|---|
| ADMIN (1) | `/org/{siteName}/dash` (falls back to `/lms` if no siteName) |
| TUTOR (2) | `/caseload` |
| MANAGER (4) | `/reports` (top-level, NOT `/org/..`) |
| LEARNER/STUDENT (3) and any unknown | `/lms` |

Used by `/`, `/home`, `/welcome`, the sidebar logo link (`app-logo.svelte`), `change-password` success redirect, and the client post-login router `routeUserToNextPage` in `lib/features/app/init.svelte.ts` (self-hosted: on `/` or any public path -> role home; also honours `?redirect=`; forces `/change-password` first when `profile.settings.mustChangePassword` is true; tutor -> `/caseload`, manager -> `/reports`).

#### 3. `(app)/+layout.server.ts` / `+layout.ts` / `+layout.svelte`
- Server: `requireActor(locals)` — anonymous / deactivated / no-membership -> 303 `/login`. Returns `{}`. (Baseline guard for every (app) route; stale cookies without a live session are bounced here.)
- `+layout.ts`: passes parent data through.
- `+layout.svelte` (global, NO sidebar/header — those come from sub-layouts):
  - Renders global overlays: `UpgradeModal`, `VerifyEmailModal`, `ImpersonationBanner` (amber top bar when an admin "logged in as" a learner/tutor; cookie `impersonating`; "Return to admin"), `CommandPalette` + `KeyboardShortcutListener` (search/shortcuts).
  - Gate: if `data.org?.isRestricted || $currentOrg.isRestricted` -> `PageRestricted` instead of the app; else `PageLoadProgress` + children.
  - Client auth guard: `authClient.useSession()`; no session and not a public route (and not `skipAuth`) -> `window.location.href='/login'`.
  - **Presence heartbeat**: every 60 s `POST /account/heartbeat` (`classroomio.account.heartbeat.$post`) while signed in (feeds the admin "Online now" panel).
- Implication: top-level pages (`/reports`, `/registrations`, `/messages`, `/change-password`, `/welcome`) render **without any sidebar, header, logout button or notification bell** unless the page supplies its own shell.

#### 4. `(app)/org/[slug]/+layout.server.ts`
- Redirect 307 `/lms` if on a non-app subdomain and not self-hosted (multi-tenant leftover).
- **`requireAdmin(locals)`** — the whole `/org/[slug]/**` tree (dash, courses, settings, learners, tutors, reports, etc.) is **ADMIN only, enforced server-side**. Tutors, Managers and Learners get a **403 "You do not have permission to view this page"** page (not a redirect). Consequence: nav entries flagged for non-admins (e.g. Reports sub-items without `requiresAdmin`, Community, Media, Settings for non-admin) are effectively unreachable for non-admins; the client-side "isOrgStudent -> goto /lms" effect in `org/[slug]/+layout.svelte` never runs for a real learner because the server 403 fires first (upstream leftover).
- Resolves `params.slug` -> orgId via `getOrgBySiteName` (API key headers), caches in cookie `cio_org_id_{slug}` (7 d, readable by JS), then **`requireSameOrg(locals, orgId)`** (403 if slug belongs to another org). Returns `{orgName: slug, orgId}`.

#### 5. `(app)/org/[slug]/+layout.svelte` — the admin shell
- If `data.orgName === '*'` it redirects to the real `$currentOrg.siteName` and shows 3 skeleton cards.
- Renders `AddOrgModal` only when NOT self-hosted. Then `Sidebar.Provider` > `OrgSidebar` + `Sidebar.Inset` > `AppHeader` + a centred `max-w-6xl` content column with the child page.
- **OrgSidebar** (`lib/features/ui/sidebar/org-sidebar/`): skeleton until `$orgs.length>0 && $profile.id`; then
  - Header `AppLogo`: org avatar (`$currentOrg.avatarUrl` or fallback `/logo-192.png`) + org name + plan badge, links to role home (`homeForRole`).
  - Content `NavMain` built by `getOrgNavigationGroups()` from `baseNavConfig` in `lib/features/ui/navigation/org-navigation.ts`.
  - Footer `UpgradeTrigger` (free-plan "early adopter" student-quota card; **never shown self-hosted** because `isOrgOnFreePlan` returns false when self-hosted) and `SidebarFooterMenu` (user dropdown: profile link -> `{basePath}/settings`, theme toggle (light/dark), and — when not an org-site — UserJot "What's new" + "Feedback", "Documentation" link `https://classroomio.com/docs`, "Need help" `mailto:help@classroomio.com`, "Log out" -> `/logout`) plus a standalone always-visible `SidebarLogoutButton`. Role label under the avatar via `getRoleLabel` (handles ADMIN/TUTOR/STUDENT only — MANAGER shows blank).
  - A "source code" AGPL link in the footer is commented out ("temporarily hidden, owner request 2026-09-07").
- **AppHeader** (`lib/features/ui/navigation/app-header.svelte`): sidebar trigger, `AppBreadcrumbs` (contains `OrgSwitcher` variant=breadcrumb; self-hosted shows org name/avatar only, no switching), `HeaderContext`, and `NotificationBell` (popover; `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`; polls every 60 s; item click deep-links; table `notification`).
- **Org-switcher** (`org-switcher.svelte`): multi-workspace switch (`localStorage classroomio_org_sitename`, then full reload). Self-hosted = display only. Dead in prod.
- **Broadcast banner**: NOT in the shell. `BroadcastBanner` (`features/announcements/components/broadcast-banner.svelte`, `GET /announcements`, dismissals in `localStorage pearl.dismissedBroadcasts`) is rendered only at the top of the **tutor caseload** page and the **learner `/lms` dashboard**. Admin/manager never see it. Broadcast composing UI is at `/org/[slug]/broadcasts` (other agent's scope).

#### 6. Effective admin nav in production (flags from `features.ts`, all `false` unless noted)
Visible: **Dashboard** (`/dash`), **Reports** (Learners, Courses, Marking, Completions, Referrals*, Tutor feedback*, Activity log* — *admin-only), **Courses**, **Media**, **Community** (nav present; learner community itself `COMMUNITY_ENABLED=false`), **Learners**, **Tutors**, **Admins**, **Progression**, **Broadcasts**, **Settings** -> Profile, Notifications, Organization (General/Domains/Teams/Customize LMS), Auth(isPaid flag).
Hidden by flag: Home (`ORG_HOME_ENABLED`), Cohorts (`COHORTS_ENABLED`), Tags (`TAGS_ENABLED`), Widgets (`WIDGETS_ENABLED`), MCP (`AI_ENABLED`), API (`API_ACCESS_ENABLED`), Zapier (`ZAPIER_ENABLED`), Audience (`AUDIENCE_NAV_ENABLED`), Users (`LEGACY_USERS_NAV_ENABLED`), Allocation (`LEGACY_ALLOCATION_NAV_ENABLED`), Settings->Landing page (`LANDING_PAGE_ENABLED`), Settings->Billing (`BILLING_ENABLED`), Settings->AI credits + AI tutor (`AI_ENABLED`). **Never in nav at all:** Settings->Integrations, Settings->Workspaces, `/registrations`, `/announcements`, `/messages`, `/widget-preview`.
Manager has **no sidebar at all** (lands on bare `/reports`); Tutor sidebar is `features/caseload/components/tutor-sidebar.svelte`; Learner sidebar is `lms-sidebar` (not in scope).

#### 7. Self-hosted licence
`apps/api/src/services/license.ts` returns `{valid:true, features: ALL}` with no phone-home, so `licenseApi.hasAccess('sso'|'token-auth')` is true for everyone and the SSO and Token-auth tabs always show.

---

### Settings routes — `/org/[slug]/settings/**`

Common to ALL entries below: gated by the `org/[slug]` layout `requireAdmin` + `requireSameOrg` (ADMIN only, server-side). Settings sub-layout `settings/+layout.svelte` wraps everything in `Page.Root` (max-w-3xl, centred) and, only on `/settings/org`, `/settings/customize-lms`, `/settings/domains`, `/settings/teams`, adds the header "Organization" and the inline tab strip `OrgSettingsInlineTabs` (General | Custom domain | Team | Customize LMS). Page `<title>` strings are all `"... - Integer Training LMS"` (hardcoded, in each `+page.svelte`). Save bar on form pages = `Page.SettingsActions` (unsaved-changes label, Discard, Save changes) with the `UnsavedChanges` navigation guard.

#### Settings shell/layout — `/org/[slug]/settings` (layout `+layout.svelte`)
- **Roles:** ADMIN only (org layout guard). Nav: "Settings" parent (hash-URL collapsible) in sidebar.
- **Reached from:** sidebar Settings group; user menu avatar link (-> `{basePath}/settings`).
- **Purpose:** page chrome for all settings pages.
- **UI & actions:** described above.
- **API calls:** none.
- **Data:** none.
- **Wired?:** working.
- **Brand strings:** none in the layout itself.

#### Profile settings — `/org/[slug]/settings`
- **Roles:** ADMIN (route is under org layout). Nav item "Settings -> Profile" (`settings.tabs.profile_tab`). API: account profile endpoint is self-only (`authMiddleware`).
- **Reached from:** sidebar Settings > Profile; user-menu header.
- **Purpose:** the signed-in admin's own profile.
- **UI & actions:** `ProfilePage` (`lib/features/settings/pages/profile.svelte`) + `VisitOrgSiteButton` in the header (opens the org public site). Sections: Profile picture (`UploadImage`); Personal information: Full name (`Input`), Username (`Input`), Email (`Input type=email`; typing a new email reveals Confirm / Cancel buttons -> sends a change-email verification, shows a green "verification sent" and amber note), Language (`LanguagePicker`). Server validation errors are shown inline per field (`fullname`, `username`, `newEmail`). Sticky save bar: Save changes / Discard.
- **API calls:** Better Auth `authClient.updateUser` and `authClient.changeEmail` (`/api/auth/*` proxied); `PUT /account/profile` (`classroomio.account.profile.$put`); `lib/features/auth/api/profile.svelte.ts`.
- **Data:** `user` (Better Auth), `profile` (fullname, username, locale, avatarUrl).
- **Wired?:** working. (Telegram `profile.telegramChatId` is separate, see Integrations.)
- **Brand strings:** `<title>Settings - Integer Training LMS</title>`.

#### Notifications — `/org/[slug]/settings/notifications`
- **Roles:** ADMIN reaches it (org layout). Nav "Settings -> Notifications". The component also contains branches for students (hides `newStudent`/`newSubmission` toggles for `$isOrgStudent`) that are **unreachable** since non-admins are 403'd from `/org/*` (upstream leftover). API: `member/email-notifications` is member-scoped.
- **Reached from:** sidebar Settings > Notifications.
- **Purpose:** email notification preferences.
- **UI & actions:** (1) "Your email notifications" — per-user switches grouped into sections Course (`newStudent`, `newSubmission`, `gradingResult`, `newsfeed`, `quizAssigned`, `session`, `courseCompletion`) and Cohort (`cohortReminder`); (2) admin-only "Organisation defaults" — same keys plus Enrollment (`enrollmentWelcome`), saved into `organization.settings.emailNotifications`; (3) `CommsPreferences` — PearlLMS per-category "Communication emails" switches that auto-save per toggle (no save bar), note "In-app notifications always arrive". Labels/descriptions come from i18n keys `settings.notifications.toggles.<key>.*`. Save bar saves personal and org blocks independently; success snackbars.
- **API calls:** `GET/PUT /organization/member/email-notifications` (`classroomio.organization.member['email-notifications']`, `settings/api/member-email-notifications.svelte.ts`); `PUT /organization` with `{settings:{emailNotifications}}` (`orgApi.update`); `GET /notifications/preferences`, `PUT /notifications/preferences/:category` (`notifications/api/preferences.svelte.ts`).
- **Data:** `organizationmember_email_notifications` (`organizationmemberEmailNotifications`), `organization.settings`, `notification_preference` (`notificationPreference`).
- **Wired?:** working. Several toggle keys (`cohortReminder`, `quizAssigned`, `session`, cohort-related) refer to upstream features that are disabled in this deployment (cohorts off, no live sessions) — the toggles save but nothing sends.
- **Brand strings:** title `... - Integer Training LMS`; code comment "PearlLMS Phase 6"; hard-coded English in `comms-preferences.svelte` ("Communication emails", etc.).

#### Organisation (General) — `/org/[slug]/settings/org`
- **Roles:** ADMIN. Nav "Settings -> Organization" (active for org/customize-lms/domains/teams). API `PUT /organization` = `orgAdminMiddleware`.
- **Reached from:** sidebar Settings > Organization; inline tabs.
- **Purpose:** org name, logo, colour theme.
- **UI & actions:** Organisation name (`Input`, API-validated `name`), Logo (`UploadImage`, rounded 96px), Theme picker — 5 preset swatches (blue `#1d4ee2` default, rose `#be1241`, green `#0c891b`, orange `#cc4902`, purple) + custom colour (`svelte-awesome-color-picker`, hex stored in `theme`). Theme applies instantly (`setTheme`) and auto-saves after a 2 s debounce independent of the save bar. Save bar saves name + avatar.
- **API calls:** `PUT /organization` (`classroomio.organization.$put` via `orgApi.update`, `lib/features/org/api/org.svelte.ts`).
- **Data:** `organization` (name, avatarUrl, theme).
- **Wired?:** working.
- **Brand strings:** title "Organization Settings - Integer Training LMS"; sidebar logo fallback `/logo-192.png`.

#### Customize LMS — `/org/[slug]/settings/customize-lms`
- **Roles:** ADMIN. Reached via inline tab "Customize LMS" (and nav Organization group).
- **Purpose:** toggle learner-dashboard features and branding images stored in `organization.customization`.
- **UI & actions:** Dashboard: Community switch, Exercises switch, Banner image (opens `UploadWidget`), Banner text (`Input`). Auth background image: Replace/Reset buttons + 280x200 preview (disabled on free plan; never free in self-hosted). Course: Newsfeed switch, Grading switch. Apps: Poll switch, Live comments switch. Each switch shows Enabled/Disabled text. Save bar with unsaved JSON-snapshot diff.
- **API calls:** `PUT /organization` with `{customization}`.
- **Data:** `organization.customization` (jsonb: `dashboard.{community,exercise,bannerImage,bannerText}`, `auth.backgroundImage`, `course.{newsfeed,grading}`, `apps.{poll,comments}`).
- **Wired?:** saves fine, but effect is partial: Community/Exercises/Newsfeed/Poll/Comments flags are upstream-only and the PearlLMS learner surfaces mostly ignore them (community is separately killed by `COMMUNITY_ENABLED`). Auth background image is used by the login page.
- **Brand strings:** fallback preview image `/images/classroomio-course-img-template.jpg`; title "Customize LMS - Integer Training LMS".

#### Custom domain / Teams / etc. — see next entries.

#### Domains — `/org/[slug]/settings/domains`
- **Roles:** ADMIN. API `POST /domain` = `authMiddleware`+`orgAdminMiddleware`. Inline tab "Custom domain".
- **Reached from:** Organization inline tabs.
- **Purpose:** sub-domain slug, custom domain via third-party hostname service, favicon, custom code.
- **UI & actions:** (a) "URL" — `DomainInput` with prefix `https://` and suffix `.myclassroomio.com`, button "Update" (changes `siteName`, validates, blocks reserved sub-domains, then navigates to the new `/org/<newslug>/settings/domains`) + `VisitOrgSiteButton forceSubdomain`; (b) Custom domain — `UpgradeBanner`, input "yourwebsite.com" + Save; when connected shows status badge (verified / pending DNS / pending verification / reconnect required / error / removed), DNS record table (name/value with copy), validation errors, SSL-pending notice, Reconnect / Refresh / Remove buttons; auto-polls refresh every 15 s; rejects classroomio domains (`custom_domain_not_classroomio`); (c) Custom favicon — `UploadImage` + Save/Remove; (d) Custom code — textarea permanently disabled with `ComingSoon`.
- **API calls:** `POST /domain` `{action: connect|refresh|remove, domain}` (`apps/api/src/routes/domain/domain.ts`, service `apps/api/src/services/org/domain.ts` -> **Approximated** `https://cloud.approximated.app/api`, needs env `APPROXIMATED_API_KEY`, `APPROXIMATED_TARGET_ADDRESS`); `PUT /organization` (siteName, favicon).
- **Data:** `organization` (siteName, customDomain, isCustomDomainVerified, favicon).
- **Wired?:** working code but **needs Approximated credentials**; on self-hosted prod the sub-domain slug input is misleading (tenant sub-domains `*.myclassroomio.com` are the vendor's cloud; PearlLMS uses one domain). Custom code = stub.
- **Brand strings:** suffix `.myclassroomio.com` (`TENANT_ROOT_DOMAIN` in `packages/utils/src/constants/domains.ts`), `BRAND_ROOT_DOMAIN='classroomio.com'`, placeholder `myschool`, fallback favicon `/logo-512.png`, title "Custom domain - Integer Training LMS".

#### Teams — `/org/[slug]/settings/teams`
- **Roles:** ADMIN. Inline tab "Team". Remove buttons only for team members who are admins. API `organization/team*` admin routes.
- **Reached from:** Organization inline tabs.
- **Purpose:** invite and list org staff (Admin/Tutor).
- **UI & actions:** Add team: free-text emails (comma/space separated, validated by `validateEmailInString`), role `Select` (Admin or Tutor only — no Manager option!), "Copy invite link" (generates reusable link invite for the role and copies `{origin}/invite/link/{token}`), "Send invite" button. Members list: email, role badge, "invite sent" badge if unverified, "You" marker, Remove button (red). Spinner while loading. `UpgradeBanner` shows only on free plan.
- **API calls:** `GET /organization/team`, `POST /organization/team/invite`, `DELETE /organization/team/:memberId`, `GET/POST/PATCH /organization/link-invite` (`org.svelte.ts` lines ~93, 478, 505, 680-705).
- **Data:** `organizationmember`, `organizationInvite` (+`organizationInviteAudit`), `profile`.
- **Wired?:** working, but **bypasses the PearlLMS provisioning model**: ACCESS.md notes the reusable link-invite lets any authenticated user self-join at its role; no MANAGER role in the picker (managers must be provisioned elsewhere, e.g. `/org/[slug]/users`/`admins`).
- **Brand strings:** title "Teams - Integer Training LMS"; invite URL uses `getAppOrigin()`.

#### Auth settings (General) — `/org/[slug]/settings/auth`
- **Roles:** ADMIN. Nav "Settings -> Auth" (flagged `isPaid`, shows upgrade marker only on non-self-hosted). Tabs SSO / Token auth appear if licensed (always, here).
- **Reached from:** sidebar Settings > Auth.
- **Purpose:** org sign-up/sign-in policy.
- **UI & actions:** `UpgradeBanner` ("enterprise required"; hidden self-hosted), underline tabs General | SSO | Token auth. General (`auth-general.svelte`): switches — Disable sign-up, Allow public sign-ups (inverse of `settings.signup.inviteOnly`), Internal enrollment only (`settings.internalEnrollmentOnly`), Disable email+password, Disable Google auth; textarea "Disabled sign-up message"; a lock Alert note. Save bar.
- **API calls:** `PUT /organization` `{disableSignup, disableSignupMessage, settings:{signup:{inviteOnly}, internalEnrollmentOnly}, disableEmailPassword, disableGoogleAuth}`.
- **Data:** `organization` columns `disable_signup`, `disable_signup_message`, `disable_email_password`, `disable_google_auth`, `settings` jsonb.
- **Wired?:** **upstream leftover / misleading**. PearlLMS is closed: sign-up is hard-disabled in code (`emailAndPassword.disableSignUp:true`, Google provider removed, ACCESS.md §1.2), so these switches change DB fields but do not drive the real policy. Disabling email+password here could lock everyone out of the login UI.
- **Brand strings:** title via i18n `settings.auth.title` + "- Integer Training LMS".

#### Auth SSO — `/org/[slug]/settings/auth/sso`
- **Roles:** ADMIN; redirects to `/settings/auth` if licence missing (never in this fork).
- **Reached from:** Auth > SSO tab.
- **Purpose:** configure OIDC SSO connection for the org.
- **UI & actions:** same `AuthPage` shell with the SSO tab selected: provider form (issuer, client id/secret etc. in `auth-sso.svelte`/`pages/sso.svelte`), callback URL helper `{origin}/api/auth/sso/callback/{providerId}`, Create/Update/Delete/Activate, domain-policy (enforce SSO) toggle. (Page title shows tabs.sso string; header is the shared "Auth" title.)
- **API calls:** `GET/POST/PUT/DELETE /organization/sso`, `POST /organization/sso/activate`, `GET/PUT /organization/sso/policy` (all `orgAdminMiddleware`), `GET /sso/discover`, `GET /sso/org/:orgId` (`lib/features/org/api/sso.svelte.ts`).
- **Data:** `organization_sso_config`, `sso_provider`, `organization_auth_policy`.
- **Wired?:** code works; **intentionally inert** — no provider configured (ACCESS.md §1.2 "inert vectors"); JIT account creation would bypass provisioning if ever enabled. Replicate only if SSO is wanted.
- **Brand strings:** title "... - Integer Training LMS".

#### Auth Token-auth — `/org/[slug]/settings/auth/token-auth`
- **Roles:** ADMIN; redirects if unlicensed (never here).
- **Reached from:** Auth > Token auth tab.
- **Purpose:** configure signed-token login exchange for embedding.
- **UI & actions:** `auth-token-auth.svelte`: shows status, generate/rotate secret (shown once), example request and docs snippet built from `baseUrl`, enable/disable.
- **API calls:** `/organization/token-auth*` (`org/api/token-auth.svelte.ts`, router `apps/api/src/routes/organization/token-auth.ts`), exchange endpoint `/api/auth/token-exchange` (Better Auth plugin `tokenExchange()`).
- **Data:** `organization_token_auth`.
- **Wired?:** working but inert (no secret configured in prod); example snippet hard-codes the vendor API host.
- **Brand strings:** `const baseUrl = 'https://api.classroomio.dev'` in `settings/components/auth-token-auth.svelte:56` and `settings/pages/token-auth.svelte:48`.

#### Billing — `/org/[slug]/settings/billing`
- **Roles:** ADMIN, but **HIDDEN** — `BILLING_ENABLED=false` (also not reachable by nav; URL still serves).
- **Reached from:** (hidden) Settings > Billing.
- **Purpose:** manage subscription via payment provider.
- **UI & actions:** one card: secondary-workspace notice, or "free plan active" + Upgrade button (`openUpgradeModal`), or "Open billing portal" button. Self-hosted `isFreePlan` is false so the last branch shows.
- **API calls:** browser GETs `/api/polar/portal?orgId=` or `/api/lmz/subscription?subscriptionId=`.
- **Data:** `organization_plan` (`organizationPlan`).
- **Wired?:** **dead** — the dashboard Polar routes were removed (comment in `routes.ts`: "Polar commerce routes removed"); `/api/lmz` is listed public but no handler exists in this tree. Clicking the button would 404.
- **Brand strings:** title "Billing - Integer Training LMS"; providers "polar", "lmz" (LMZ = LemonSqueezy-style upstream).

#### AI credits — `/org/[slug]/settings/ai-credits`
- **Roles:** ADMIN; **HIDDEN** — `AI_ENABLED=false`.
- **Reached from:** (hidden) Settings > AI Credits; chat-input "buy tokens" link.
- **Purpose:** AI token usage dashboard + purchase.
- **UI & actions:** `UsageSummaryCards`, cost note, `UsageChart`, `TeamLeaderboard`, `BuyTokensCard` (quantity input -> redirects to checkout). Toast on `?tokens=success`.
- **API calls:** `GET /agent/usage`, `/agent/usage/purchased`, `/agent/usage/leaderboard` (`orgMemberMiddleware`); purchase `GET /api/polar/buy-tokens?quantity&orgId` (dashboard route removed).
- **Data:** `ai_token_usage`, `ai_credit_balance`, `ai_credit_purchase`.
- **Wired?:** read side works; buy button **dead** (Polar removed). Whole page off by flag.
- **Brand strings:** "AI Credits - Integer Training LMS".

#### AI Tutor settings — `/org/[slug]/settings/ai-tutor`
- **Roles:** ADMIN; **HIDDEN** — `AI_ENABLED=false`. API: `GET /organization/ai-tutor` any member, `PUT` = `orgAdminMiddleware`.
- **Reached from:** (hidden) Settings > AI Tutor.
- **Purpose:** org-wide default AI-tutor persona/guardrails (courses can override: `/courses/[id]/ai-tutor`).
- **UI & actions:** `OrgAiTutorSettingsPage` + shared `TutorSettingsForm`: Availability (enabled switch); Personality (persona select + custom persona, response length, welcome message, disclaimer footer); Guidance (things to say / not say, forbidden topics, block off-topic, profanity filter); Assessment (assessment mode, reveal solutions after N attempts, code policy); Grounding (scope, require citations); Escalation (enabled + email). Save bar.
- **API calls:** `GET/PUT /organization/ai-tutor` (`ai-tutor-settings/api/ai-tutor.svelte.ts`).
- **Data:** `organization.settings` (ai tutor block), `ai_tutor_message_count`, `ai_tutor_cap_event`.
- **Wired?:** working but disabled; depends on AI provider keys.
- **Brand strings:** "AI Tutor Settings - Integer Training LMS".

#### Integrations — `/org/[slug]/settings/integrations`
- **Roles:** ADMIN. **Not in any nav** (reachable by URL only; the breadcrumb config mentions it).
- **Reached from:** nowhere.
- **Purpose:** connect the user's Telegram chat for notifications.
- **UI & actions:** Telegram logo; if `profile.telegramChatId !== null` shows connected tick + Disconnect; else steps text, "Open bot" button (opens Telegram bot), numeric Chat ID `Input` (placeholder 360111), Connect button.
- **API calls:** none — `addChatId` / `deleteChatId` bodies are commented-out TODOs.
- **Data:** `profile.telegram_chat_id` (not written).
- **Wired?:** **stubbed / upstream leftover** (buttons do nothing; note `telegramChatId` is `null`-checked so default `undefined` may render the "connected" branch).
- **Brand strings:** `https://t.me/classroomio_bot`, `/telegram-svg.svg`, title "Integrations - Integer Training LMS".

#### Landing page settings — `/org/[slug]/settings/landingpage` (own layout `+layout@[slug].svelte` = full-width `Page.Root`, resets out of the settings layout)
- **Roles:** ADMIN; **HIDDEN** — `LANDING_PAGE_ENABLED=false`.
- **Reached from:** (hidden) Settings > Landing page.
- **Purpose:** choose/preview the org public landing-page theme.
- **UI & actions:** sticky header with `VisitOrgSiteButton` (preview); "Current page" card (theme, hero, nav summary, Customize button -> `/edit`); live preview of selected theme; gallery of themes with per-card menu (Preview, Apply theme, Add) and upgrade gating for paid themes (`isPaidTheme`), "by ClassroomIO" attribution.
- **API calls:** `PUT /organization` `{landingpage}`; `GET` public courses via `orgApi.refreshPublicCourses` (`classroomio.organization.courses.public`).
- **Data:** `organization.landingpage` jsonb.
- **Wired?:** working but unused (PearlLMS has no public site).
- **Brand strings:** i18n `settings.landing_page.gallery.by_classroomio`; title "Landing Page Settings - Integer Training LMS".

#### Landing page editor — `/org/[slug]/settings/landingpage/edit`
- **Roles:** ADMIN; **HIDDEN** (same flag; reachable only from the landing-page screen).
- **Reached from:** Landing page "Customize" / "Add" (`?theme=<theme>`).
- **Purpose:** WYSIWYG-ish editor for the landing page.
- **UI & actions:** left sidebar "Page builder" listing sections Navigation, Hero, Links, Embed, Callout, Footer (click section in preview or list); section forms in `settings/pages/landingpage-editor/*.svelte`; Save button + Close; theme from query; live preview with `buildOrgLandingPageProps`; unsaved guard.
- **API calls:** `PUT /organization` `{landingpage}`; public course list.
- **Data:** `organization.landingpage`.
- **Wired?:** working, disabled by flag.
- **Brand strings:** none hard-coded beyond i18n; `navigation.goto_lms` / `goto_dashboard` labels.

#### Workspaces — `/org/[slug]/settings/workspaces`
- **Roles:** ADMIN. **Not in nav** (URL only). Create/delete = `authMiddleware`+`orgAdminMiddleware`.
- **Reached from:** nowhere in nav (cloud multi-workspace leftover).
- **Purpose:** create/delete extra sub-workspaces under a primary org.
- **UI & actions:** if not primary workspace -> notice; else usage banner (learners/tokens/workspaces), list of workspaces, CTA "Create workspace" with used/allowance, or disabled-limit, or "Upgrade" (links `/pricing`), create dialog (name + siteName), delete confirm dialog.
- **API calls:** `GET/POST /account/workspaces`, `DELETE /account/workspaces/:id`, `GET /account/usage`.
- **Data:** `organization` (parentOrganizationId), `organization_plan`.
- **Wired?:** **upstream leftover** — multi-org creation is blocked by the closed-system 403 on org creation (ACCESS.md §1.2); plan gating shows "upgrade"; link `/pricing` has no page.
- **Brand strings:** i18n `account.workspaces.*`; title "... - Integer Training LMS".

---

### Cohorts — `/cohorts/[id]/*`

Shared: `cohorts/[id]/+layout.server.ts` -> `requireAdmin(locals)` (ADMIN only, 403 otherwise; note this is OUTSIDE `org/[slug]`, so no slug check — org binding is enforced by the API). `+layout.svelte` builds a standalone shell: `CohortSidebar` (OrgLogo + nav Newsfeed / Courses / People (if can manage members) / Settings (admin)) + `CohortHeader` (cohort name) and shows a "Loading cohort..." state until `cohortApi.ensureCohortShell(id)` has loaded cohort, members and courses. `<title>{cohort name} - Integer Training LMS</title>`. There is **no `/cohorts/[id]` index page** (404; sidebar goes to the sub-pages). **Whole feature HIDDEN** — `COHORTS_ENABLED=false`: the `/org/[slug]/cohorts` list (the only entry point) is removed from nav; the sub-pages are only reachable by URL. Cohort sidebar also has an `?source=lms` learner mode (`/lms/cohorts`) that the admin-only layout guard makes unreachable for learners (upstream leftover).
Tables for the whole group: `cohort`, `cohort_member`, `cohort_course`, `cohort_newsfeed`, `cohort_newsfeed_comment`, `cohort_goal`, `cohort_goal_assignment`, `profile`, `course`.

#### Cohort Courses — `/cohorts/[id]/courses`
- **Roles:** ADMIN (layout). HIDDEN (`COHORTS_ENABLED`). API reads = `cohortMemberMiddleware`, writes = `cohortTeamMemberMiddleware`.
- **Reached from:** cohort sidebar.
- **Purpose:** courses attached to the cohort.
- **UI & actions:** title, info Callout "published access" (`cohorts.courses.published_access_callout_*`), "Add Course" button -> `AddCourseToCohortModal`; search box; grid/list toggle (localStorage `courseView`); list view table (Title, Description, Published badge, remove icon); grid view uses `CourseCard` with a trash button; click opens `/courses/{id}`; delete confirmation `DeleteModal`; empty state with Add Course.
- **API calls:** `GET /cohort/:id/courses`, `POST /cohort/:id/courses`, `DELETE /cohort/:id/courses/:courseId` (`features/cohort/api/cohort.svelte.ts`).
- **Data:** `cohort_course`, `course`.
- **Wired?:** working, flag-hidden.
- **Brand strings:** layout title only.

#### Cohort Newsfeed — `/cohorts/[id]/newsfeed`
- **Roles:** ADMIN (layout); in-page: post/pin/delete for org admin or cohort ADMIN/TUTOR; comments need a cohort membership. HIDDEN.
- **Reached from:** cohort sidebar.
- **Purpose:** cohort announcement feed.
- **UI & actions:** "Post" button -> `NewFeedModal` (rich text editor, preloaded), `MyGoalsWidget`, pinned-first list of `NewsFeedCard`s with reactions, comments, edit, pin, delete; `?feedId=` highlights an item; loading skeletons; empty state with Post.
- **API calls:** `GET/POST /cohort/:id/newsfeed`, `PUT/DELETE /cohort/:id/newsfeed/:feedId`, `PUT .../react`, `GET .../comments`, `POST .../comment`, `DELETE .../comment/:commentId`; goals widget `GET /cohort/my/goals`.
- **Data:** `cohort_newsfeed`, `cohort_newsfeed_comment`, `cohort_goal`/`cohort_goal_assignment`.
- **Wired?:** working, flag-hidden.
- **Brand strings:** none.

#### Cohort People — `/cohorts/[id]/people`
- **Roles:** ADMIN (layout); sidebar entry visible only to those who can manage members (org admin or cohort ADMIN/TUTOR). HIDDEN.
- **Reached from:** cohort sidebar.
- **Purpose:** members management.
- **UI & actions:** "Invite" button -> `InviteMembersModal` (invite by email / assign existing org learners; student-limit `UpgradeBanner`); search + role filter select (All/Tutor/Student); table Name/Role/Action with avatar, email, role, "You" badge, pending chip, role-change buttons and delete icon; delete-confirmation dialog.
- **API calls:** `GET/POST /cohort/:id/members`, `PUT/DELETE /cohort/:id/members/:memberId`, `POST /cohort/:id/invite`, `POST /cohort/:id/invite/assign`.
- **Data:** `cohort_member`, `profile`, `organizationInvite`.
- **Wired?:** working, flag-hidden.
- **Brand strings:** none.

#### Cohort Settings — `/cohorts/[id]/settings`
- **Roles:** ADMIN (layout); sidebar shows it for org admin or cohort ADMIN. HIDDEN.
- **Reached from:** cohort sidebar.
- **Purpose:** edit/delete cohort + goals.
- **UI & actions:** General: Name* (max 255), Description (max 2000, textarea), Status select (Active / Inactive / Archived); `GoalsSection` (create/edit/delete/evaluate goals; manage by org admin or cohort ADMIN/TUTOR); Danger zone "Delete Cohort" (browser `confirm()`, then goes to `{org}/cohorts`); Save bar.
- **API calls:** `PUT /cohort/:id`, `DELETE /cohort/:id`, goals: `GET/POST /cohort/:id/goals`, `PUT/DELETE /cohort/:id/goals/:goalId`, `POST .../evaluate`, `GET /cohort/goals/overview`.
- **Data:** `cohort`, `cohort_goal`, `cohort_goal_assignment`.
- **Wired?:** working, flag-hidden.
- **Brand strings:** none.

---

### Shared top-level routes

#### Announcements (legacy) — `/announcements`
- **Roles:** ADMIN or MANAGER (`requireManagerOrAdmin` in `+page.server.ts`). Not in nav.
- **Reached from:** old links/bookmarks only.
- **Purpose:** historic compose surface; now a forwarder.
- **UI & actions:** shows "Redirecting to Broadcasts..." then `goto(/org/{siteName}/broadcasts)` (or `/` if no org). **Managers are forwarded into an ADMIN-only route and get 403** — manager broadcast access is effectively broken.
- **API calls:** none on this page (real surface uses `/announcements` API: `GET /`, `POST /`, `POST /:id/archive`, `DELETE /:id`, `GET /courses|tutors|learners` — all `requireAdmin` except list).
- **Data:** `announcement`.
- **Wired?:** redirect works for Admin; dead-ends for Manager.
- **Brand strings:** none.

#### Registrations (approval queue) — `/registrations`
- **Roles:** ADMIN or MANAGER (`requireManagerOrAdmin`; API re-enforces and binds to actor org). **Not in any nav** — only link is "Registrations ->" on the Manager's `/reports` page; admins must type the URL.
- **Reached from:** `/reports` header link.
- **Purpose:** Phase-7 learner application approvals (docs/ONBOARDING-MODEL.md).
- **UI & actions:** title + helper text ("Approving creates the account and sends a set-password invite"); filter pills Pending / Approved / Rejected; list of cards: name, email, "Interested in: <course>", submitted time; for pending: course `<select>` (defaults to requested course, required) + Approve + Reject; Reject expands a required "Reason for rejection" textarea + Confirm reject / Cancel; decided rows show status chip, decision time and rejection note; empty text "No <status> applications".
- **API calls:** `GET /organization/registrations?status=`, `GET /organization/registrations/courses`, `POST /organization/registrations/:id/approve` `{courseId}`, `POST .../reject` `{note}` (`features/registrations/api/registrations.svelte.ts`; server `apps/api/src/routes/organization/registrations.ts`). Public submission side: `POST /registration` (api-key protected, `apps/api/src/routes/registration/registration.ts`).
- **Data:** `registration`, plus on approve: `user`, `profile`, `organizationmember`, `groupmember`, `notification`/email.
- **Wired?:** working.
- **Brand strings:** `<title>Registrations</title>` (generic); no logo.

#### Learner progress report (Manager landing) — `/reports`
- **Roles:** ADMIN or MANAGER (`requireManagerOrAdmin`; API `GET /reports/progress*` same). Manager's home (`homeForRole`). Not in the admin sidebar (admin uses `/org/[slug]/reports/*`).
- **Reached from:** manager login redirect; `/` redirect.
- **Purpose:** provider-wide per-course progress for managers.
- **UI & actions:** title "Learner progress", link "Registrations ->", course `<select>` (first course auto-loaded), table Learner / Passed (x / total) / Current position ("Unit n of N") / Status (Completed + date or In progress); states Loading, "No courses to report on.", "No enrolled learners for this course.". **No sidebar, header, logout or notification bell** (renders bare inside the (app) layout).
- **API calls:** `GET /reports/progress/courses`, `GET /reports/progress?courseId=` (`features/reports/api/progress-report.svelte.ts`; `apps/api/src/routes/reports/reports.ts`).
- **Data:** `course`, `groupmember`, `courseCompletion`, `lessonCompletion`/`courseworkResult` (progression).
- **Wired?:** working; shell is minimal.
- **Brand strings:** `<title>Learner progress</title>`; all English strings hard-coded (no i18n).

#### Home (retired) — `/home`
- **Roles:** any authenticated actor (`requireActor`).
- **Reached from:** old links.
- **Purpose:** was the public org landing behind auth.
- **UI & actions:** `+page.server.ts` always 303-redirects to `homeForRole`. `+page.svelte` (renders `OrgLandingPage`) is **never reached**.
- **API calls:** none.
- **Data:** none.
- **Wired?:** redirect only; the Svelte page is dead code.
- **Brand strings:** none.

#### Welcome (retired) — `/welcome`
- **Roles:** any authenticated actor.
- **Reached from:** old Phase-1 Manager/Tutor interim landing.
- **Purpose:** interim "your workspace is on the way" page.
- **UI & actions:** server always redirects to role home; `+page.svelte` (role copy for TUTOR/MANAGER, "Go to my caseload", Log out) is dead and its server `data.role` is never provided.
- **API calls:** none. **Data:** none.
- **Wired?:** dead page (redirect works).
- **Brand strings:** `<title>Welcome — Pearl LMS</title>`.

#### Widget preview iframe — `/widget-preview`
- **Roles:** any authenticated user (not a public route; no role guard). Not in nav. Intended to be loaded in an iframe inside the widget editor.
- **Reached from:** `WidgetIframePreview` in the widget editor (`/widgets/[widgetId]`).
- **Purpose:** isolated render target for the widget editor live preview.
- **UI & actions:** no chrome; listens for `postMessage` (`WIDGET_PREVIEW_PING`, `WIDGET_PREVIEW_RENDER` with a `TWidgetPayload`), replies `READY / RENDERED / ERROR / RESIZE`; origin allow-list (`isAllowedOrigin`: dashboard origin + localhost); transparent body. Replies are posted with target origin `'*'`.
- **API calls:** none (payload comes from the parent).
- **Data:** none.
- **Wired?:** working, but only matters if widgets are enabled. `WIDGETS_ENABLED=false` hides it.
- **Brand strings:** none.

#### Widget editor — `/widgets/[widgetId]`
- **Roles:** route lives outside `org/[slug]`, so there is NO page-level role guard (only the (app) `requireActor`); API: list/get/create/update = `orgTeamMemberMiddleware` (admin or tutor), delete/publish/rollback = `orgAdminMiddleware`. **HIDDEN** — `WIDGETS_ENABLED=false` (list page `/org/[slug]/widgets` removed from nav; this editor reachable only by URL).
- **Reached from:** `/org/[slug]/widgets` cards.
- **Purpose:** configure an embeddable course-catalogue widget.
- **UI & actions:** loads widget by id (spinner, "waiting for org", error + Back button to `{org}/widgets`); `WidgetEditorPage`: layout picker, design options, course filter popover, embed/share code panel, live preview iframe, publish / rollback, header with save.
- **API calls:** `GET /organization/widgets/:id`, `PUT /organization/widgets/:id`, `POST .../publish`, `POST .../rollback`, `DELETE`, plus list/create (`features/widget/api/widget.svelte.ts`, router `apps/api/src/routes/organization/widgets.ts`); embeds served by `apps/embeds` + API `widgets` router.
- **Data:** `widget`, `widget_course`, `widget_version`.
- **Wired?:** working but unused in PearlLMS (flag off).
- **Brand strings:** embed snippet points to the ClassroomIO embeds host (check `apps/embeds` / widget embed code for `classroomio.com` URLs).

#### Messages (learner entry) — `/messages`
- **Roles:** any authenticated actor (`requireActor`); API enforces participant + allocation. In practice the learner's "message my tutor" page; tutors use `/caseload/messages`.
- **Reached from:** learner dashboard (`/lms`) buttons and unit page; tutor sidebar highlights `/messages` as the Messages item.
- **Purpose:** tutor<->learner text chat.
- **UI & actions:** resolves allocated tutor (`GET /messages/my-tutor`), opens the pair thread; Empty state "No tutor yet — You'll be able to message your tutor once one is allocated."; otherwise `MessageThread`: oldest-first history, textarea "Write a message..." + Send icon button (disabled when empty), read-only banner with lock icon when archived (re-allocation) or viewed by an Admin overseer; text only, no attachments.
- **API calls:** `GET /messages/my-tutor`, `POST /messages/open` `{counterpartId}`, `GET /messages/threads`, `GET /messages/threads/:id`, `POST /messages/threads/:id/messages` `{body}`, `POST /messages/threads/:id/read`.
- **Data:** `message_thread`, `message`, `message_read`, `tutor_allocation`, `notification`.
- **Wired?:** working. No app shell around the page (bare).
- **Brand strings:** `<title>Messages</title>`; hard-coded English.

#### Conversation — `/messages/[threadId]`
- **Roles:** any authenticated actor to render; API allows participants or Admin oversight (read-only).
- **Reached from:** notification deep links, learner dashboard "recent messages", tutor opening a learner thread from caseload learner detail.
- **Purpose:** a specific thread.
- **UI & actions:** same `MessageThread` with title "Conversation".
- **API calls:** `GET /messages/threads/:threadId`, `POST .../messages`, `POST .../read`.
- **Data:** `message_thread`, `message`, `message_read`.
- **Wired?:** working.
- **Brand strings:** `<title>Conversation</title>`.

#### Change password — `/change-password`
- **Roles:** any authenticated actor (no server guard besides (app) `requireActor`). Forced target for admin-provisioned accounts: client router sends users with `profile.settings.mustChangePassword` here until they change it. Not in nav.
- **Reached from:** `routeUserToNextPage` redirect after login; admin-created / reset accounts get `mustChangePassword:true` (`apps/api/src/services/organization/users.ts`).
- **Purpose:** force-set own password on first login.
- **UI & actions:** card "Set a new password": Current (temporary) password, New password (>= 8 chars, hint), Confirm new password, "Update password" submit (disabled until current filled, new >= 8 and matching). Inline errors ("at least 8 characters", "do not match", server message). On success clears `mustChangePassword` locally and goes to `homeForRole`. Copy switches between "temporary password" wording and "Choose a new password".
- **API calls:** `POST /account/change-password` `{currentPassword,newPassword(8-128)}` (`apps/api/src/routes/account/account.ts`, uses Better Auth changePassword, then `updateProfile(settings.mustChangePassword=false)`).
- **Data:** `account` (password hash), `profile.settings`.
- **Wired?:** working. Bare page (no logout link). No lockout if user skips: only the client router enforces the redirect (a user can still navigate by URL).
- **Brand strings:** `<title>Change your password</title>`; all English hard-coded.

---

### Cross-cutting observations (for the Gecko replication)
1. **Brand surfaces to replace in this scope:** page titles "... - Integer Training LMS" (every settings `+page.svelte`, cohorts layout), "Welcome — Pearl LMS"; `help@classroomio.com`, `https://classroomio.com/docs` (footer menu); `https://t.me/classroomio_bot`; `https://api.classroomio.dev` (token-auth examples); `.myclassroomio.com` / `classroomio.com` constants (`packages/utils/src/constants/domains.ts`); `/logo-192.png`, `/logo-512.png`, `/images/classroomio-course-img-template.jpg`; localStorage keys `pearl.dismissedBroadcasts`, `classroomio_org_sitename`, `classroomio_locale`; cookie prefix `classroomio`/`cio_*`; i18n `by_classroomio`.
2. Admin-only enforcement is server-side at `org/[slug]/+layout.server.ts`; cohorts has its own `requireAdmin`; widgets/[widgetId] has none.
3. Dead/unwired in prod: Billing + AI credits purchase (Polar removed), Integrations (Telegram stub), Workspaces (closed-system), Auth-general switches (sign-up hard-disabled in code), `/home` and `/welcome` Svelte pages, custom code box, student branches in notifications page.
4. Manager experience is thin: lands on a bare `/reports` with no shell/logout; `/announcements` forwarder sends managers into a 403.
5. Organisation settings, the org layout and the sidebar assume a single org (self-hosted), but cookies/params still carry the slug.


---

# Appendix B — Course workspace and tutor caseload

## 12 — Course screens (`courses/[id]/**`) and Tutor caseload (`caseload/**`)

Source: `apps/dashboard/src/routes/(app)/courses/[id]/**` and `.../caseload/**`, plus the `$features/course` and `$features/caseload` code they render, plus `apps/api/src/routes/{course,caseload}` and `apps/api/src/services/{coursework,caseload,progression}`. READ-ONLY audit, 2026-10-27. All paths below are repo-relative to `C:\Users\PC\Projects\LMSclassroom`.

### 0. Cross-cutting facts you need before reading the entries

**Roles in play.** Org role ids: 1 ADMIN, 2 TUTOR, 3 STUDENT (learner), plus MANAGER (new). Two separate things exist and are easy to confuse:
- *Org role* (`actor.role`, `currentOrg.roleId`) — drives home redirect (`apps/dashboard/src/lib/utils/functions/routes/homeForRole.ts`: Admin -> `/org/{siteName}/dash`, Tutor -> `/caseload`, Manager -> `/reports`, Learner -> `/lms`) and server guards (`requireAdmin`, `requireStaff` in `apps/dashboard/src/lib/server/guards.ts`).
- *Course group role* (`groupmember.role_id` 1/2/3 in the course's `group`) — drives the stock `RoleBasedSecurity` component (`apps/dashboard/src/lib/features/ui/role-based-security.svelte`): shows children if the viewer's course-group role is in `allowedRoles`, **or the viewer is org admin** (no bypass when `isStudentExperience`). `allowedRoles={[1]}` = course admin only; `[1,2]` = course admin or course tutor.

**Course layout admits any authenticated actor.** `courses/[id]/+layout.server.ts` only calls `requireActor`. Every admin sub-page re-guards itself with `requireAdmin(locals)` in its own `+page.server.ts`/`+layout.server.ts` (ADMIN org role only; a course-team TUTOR gets HTTP 403 from SvelteKit, not just a hidden button). The two pages with NO server guard are the lesson-view routes `lessons` and `lessons/[lessonId]` (and the news-feed root `courses/[id]`), by design: enrolled learners must reach them. Non-members are stopped by the layout's client `isPermitted` dialog and by the API (`courseMemberMiddleware` = `isUserCourseMemberOrOrgAdmin`).

**Learner vs admin "view".** `isStudentExperience` (self-hosted: org role == STUDENT) / `isCourseLearnerView` switch the whole course shell between learner UI and authoring UI. A tutor is NOT a learner view: if a tutor deep-links to `/courses/<id>/lessons/<id>` they get the read-only admin-style view with no edit pencil (pencil is `RoleBasedSecurity allowedRoles=[1]`), no assessment cards, and the sidebar nav (see `course-sidebar-navigation.svelte`) lists admin items (most of which then 403 server-side). Tutors normally never see `/courses/**`; their home is `/caseload`. A tutor who is only *allocated* (not on the course team / group) cannot even load `/courses/<id>` (API `GET /course/:id` is `courseMemberMiddleware`).

**Feature switches** (`apps/dashboard/src/lib/utils/constants/features.ts`, all hard-coded `false` in this fork): `AI_ENABLED` (hides AI tutor nav, Ask-AI bar, AI side-panel, header AI button), `CERTIFICATES_ENABLED` (hides Certificates nav item everywhere), plus org-level ones not in this scope. Pages hidden only by nav are still reachable by URL for ADMIN.

**Course sidebar nav, by role** (`apps/dashboard/src/lib/features/course/components/sidebar/course-sidebar-navigation.svelte`):
| Item | Admin | Learner | Extra gate |
|---|---|---|---|
| News feed (`/courses/:id`) | yes | only if `currentOrg.customization.course.newsfeed` | |
| Content (`/lessons`, with section/lesson tree + "+" add buttons) | yes (with "+" and edit icons) | yes (lock icons, no "+") | |
| Certificates | HIDDEN | HIDDEN | `CERTIFICATES_ENABLED=false` |
| Analytics | yes | no | |
| Attendance | yes | no | course.type == `LIVE_CLASS` |
| Submissions | yes | no | |
| Marks | yes | only if `customization.course.grading` | course.type == `LIVE_CLASS` |
| Compliance | yes | (learner sees a compliance status card instead) | course.type == `COMPLIANCE` |
| Landing page | yes | no | |
| People | yes | no | |
| AI tutor | HIDDEN | no | `AI_ENABLED=false` |
| Settings | yes | no | |
Footer for learners: `LearnerCourseProgress` (result-derived passed/total, `GET /course/:id/learner-progress`), `PoweredBy` attribution, Logout.

**Two lock models coexist.** (1) PearlLMS `course.sequential_unlock` (Settings -> "Sequential unlock"; server-enforced, see UNLOCK-MODEL). (2) Stock `metadata.progressionMode` free/sequential radio and per-lesson `isUnlocked` lock toggle (client/stock). Replicator should keep (1) and decide whether to delete (2).

**Assessment model actually used (the "ePEARL coursework")**: an assessment is NOT a quiz. It is a *file in a lesson's `documents[]` jsonb tagged with `kind` in `workbook | casestudy | assignment`* (constants `packages/utils/src/constants/assessment.ts`; `assignment` is a legacy alias labelled "Workbook"), carrying `dueAt` and `allowDrafts`. The doc `key` is the `assessmentKey`. Learner uploads PDF/Word files as a `coursework_submission` (type `final` or `draft`, versioned per learner+lesson+assessment). Tutor records a `coursework_result` per version: `kind=verdict` (result PASS/REFER from `RESULT_VALUES`) for finals; `kind=draft` (feedback only, result NULL, never gates) for drafts. The stock `exercise`/`question`/`submission` quiz stack is still wired in the admin course editor but is admin-only on the dashboard and not part of the learner loop.

**Result vocabulary**: `PASS`/`REFER`, labels "Pass"/"Refer" (`packages/utils/src/constants/result.ts`). Unit types: `induction`, `id-check`, `session`, `portfolio-review` (`unit-type.ts`); exempt from gating: `induction`, `id-check`; `lesson.is_optional` also non-gating.

**Where Admin marks.** There is no admin coursework grading UI under `courses/[id]`. Admin (and tutors) grade through `/caseload/**` (`requireStaff` permits ADMIN; admin roster = org-wide union via `listAllocatedLearnersForOrg`). The admin nav link to `/caseload` was not verified (not in this scope) — it is reachable by URL.

---

### A. Course shell and `courses/[id]/**`

#### Course shell (layout) — `/courses/[id]` (`+layout.server.ts`, `+layout.svelte`)
- **Roles:** any authenticated actor passes the server load (`requireActor`). Client `isPermitted` = org admin OR a member of the course group; otherwise a modal "not permitted" with a button to `/org/*`. Learner view vs authoring view chosen by `isStudentExperience`.
- **Reached from:** admin Courses list card; learner `/lms` course cards / My Learning; Tutor never (they use `/caseload`).
- **Purpose:** wraps every course sub-page: resizable course sidebar (persisted width in localStorage `COURSE_SIDEBAR_STORAGE_KEY`), course header, content-create modal, course-completion modal (stock), side panel rail (transcript panel; AI panel only if `AI_ENABLED`), confetti on exercise pages.
- **UI & actions:** loads course into `courseApi` store (`setCourse`/`ensureCourse`), loads the sequential-unlock map (`courseUnlockApi.load`) for outline lock states. Shows "Loading course..." until `courseApi.course.id == courseId && group.id`. `CourseHeader` (`course/components/course-header.svelte`): sidebar trigger, current nav-section title, publish/public badges (non-learner), "View course site" button + overflow menu (View as student modal, etc.), AI button only if `AI_ENABLED`; the stock self-asserted progress popover is removed for learners (Phase 5).
- **API calls:** `GET /course/:courseId` (`apps/api/src/routes/course/course.ts`, `courseMemberMiddleware`); `GET /course/:courseId/unlock` (course.ts:285); `GET /course/:courseId/learner-progress` (course.ts:300, learner sidebar); `PUT/GET` setup-progress (org) from header.
- **Data:** `course`, `group`, `groupmember`, `course_section`, `lesson` (+ computed unlock map, `coursework_result`).
- **Wired?:** working. Stock completion modal (`course-completion-modal.svelte`) and Confetti are upstream leftovers whose triggers are dead because completion is no longer self-asserted.
- **Brand strings:** `<title>` fallback `'Integer Training LMS Course'` (`+layout.svelte:169`); sidebar footer `PoweredBy` (see Brand section) with link to `https://classroomio.com`, `img alt="ClassroomIO"`, logo `/logo-192.png`; i18n keys `public_course.powered_by.brand` = "Integer Training LMS" (en.json:220).

#### News feed (course home) — `/courses/[id]` (`+page.svelte`, `+page.ts`)
- **Roles:** `RoleBasedSecurity allowedRoles=[1,2]` (+`3` if `org.customization.course.newsfeed`). Denied -> redirected to `/courses/:id/lessons?next=true` (which then jumps to first incomplete unlocked unit). So learners go straight to content unless the org enabled newsfeed.
- **Reached from:** Sidebar "News feed", course card click.
- **Purpose:** course announcements/posts feed with reactions and comments.
- **UI & actions:** "New post" button (opens `new-feed-modal` with TipTap editor, `preloadTextEditor()` on hover), refresh, feed list (`NewsFeedPage` -> `pages/newsfeed.svelte`, cards with reactions/comments, edit/delete for team).
- **API calls:** `GET/POST /course/:id/newsfeed`, `GET/PUT/DELETE /course/:id/newsfeed/:feedId`, `PUT .../:feedId/react`, `GET/POST .../:feedId/comment(s)`, `PUT/DELETE .../comment/:commentId` (`routes/course/newsfeed.ts`; read = `courseMemberMiddleware`, write/delete = `courseTeamMemberMiddleware`, i.e. org admin or group role 1/2).
- **Data:** `course_newsfeed`, `course_newsfeed_comment`.
- **Wired?:** working (upstream feature, unchanged). Probably unused in the apprenticeship model.
- **Brand strings:** none hard-coded (i18n `course.navItem.news_feed.*`).

#### Lessons (course outline / content manager) — `/courses/[id]/lessons` (`lessons/+page.svelte`, `+page.ts`)
- **Roles:** no server guard. Admin: full authoring (buttons wrapped in `RoleBasedSecurity allowedRoles=[1]`). Learner: read-only outline with lock icons + "Continue". Tutor deep-link: read-only. `?next=true` makes the page auto-redirect to the first incomplete + unlocked lesson/exercise (used as the "denied" landing).
- **Reached from:** Sidebar "Content", news-feed redirect, learner course cards, "View as student".
- **Purpose:** the ordered curriculum: Phase (= `course_section`) -> Unit/Session (= `lesson`) (+ stock exercises).
- **UI & actions:** 3 stat tiles (sections / lessons / exercises). Admin header buttons: "Start/End reorder" (drag-and-drop with `svelte-dnd-action`; persists on End), "Add content" (opens `ContentCreateModal`: radio cards Section / Lesson / Exercise (exercise = stock quiz, "from scratch / template / AI"); Section modal field = section title; Lesson modal fields = title + target section when grouping is on; required non-empty title), overflow menu `ContentPageMenu` ("Unlock all content", "Enable/disable content grouping" which toggles `course.metadata.isContentGroupingEnabled`), refresh. Per row (admin): lock/unlock toggle, edit (inline rename), delete with confirm; section header edit/delete (delete section = `DELETE /course/:id/content` with `sectionId`). Learner rows: lesson title, lock icon + hint "Locked - complete <predecessor> first" from `courseUnlockApi`, "Join" button for live-session lessons.
- **API calls:** `POST /course/:id/lesson` (create, admin), `POST /course/:id/section` (create), `PUT /course/:id/section/:sectionId`, `DELETE .../section/:sectionId`, `POST .../section/reorder`, `POST .../section/promote-ungrouped`, `POST /course/:id/lesson/reorder`, `PUT /course/:id/content` / `PUT /course/:id/content/reorder` / `DELETE /course/:id/content` (`routes/course/{lesson,section,content}.ts`; all writes `requireAdmin`), `PUT /course/:id` for metadata (`requireAdmin`).
- **Data:** `course`, `course_section` (order), `lesson` (order, `unit_type`, `is_optional`, `is_unlocked`, `documents`, `links`), `exercise`.
- **Wired?:** working (PearlLMS-adapted; admin-only writes). Exercise creation path is an upstream leftover (see exercises entry).
- **Brand strings:** none hard-coded.

#### Lesson / Unit page + lesson editor — `/courses/[id]/lessons/[lessonId]` (`+page.server.ts`, `+page.svelte`; UI in `$features/course/pages/lesson.svelte`)
- **Roles:** `+page.server.ts` has NO role guard; it fetches `GET /course/:id/lesson/:lessonId` with the user's cookies (API: `courseMemberMiddleware` + `requireCourseContentRead` = enrolled learner of a *published* course, or any staff; plus the Phase-4 unlock check -> 403 when locked). Mode is the `?mode=edit|view` query param.
  - **Admin:** pencil/save toggle -> edit mode with tabs; title input, lock toggle, delete (via `LessonPageEditHeader`).
  - **Learner (`isCourseLearnerView`):** view mode only. Locked unit shows `StudentContentLockedNotice` (server 403 + `courseUnlockApi` hint). Unlocked unit shows materials + assessment cards.
  - **Tutor (org role) deep link:** view mode, no learner assessment section, no edit controls.
- **Reached from:** outline rows, sidebar tree, `?next=true` redirect, caseload "message your tutor"/ID-check links, email links.
- **Purpose:** deliver a unit's materials (Documents, Note, Videos, Slides, live-session card) and, for learners, submit coursework; for admin, author the unit.
- **UI & actions (edit mode, Admin):** tabs, default order **Docs, Note, Video, Slide** (`lesson/constants.ts`, overridable per course via `metadata.lessonTabsOrder`) + fixed **Settings** tab. Autosave 2 s after last change, plus save on leaving edit mode; "Saving.../Saved" indicator; localStorage draft recovery (`utils/lesson-draft`, `window.confirm` restore prompt); `UnsavedChanges` guard; language selector (`TLocale` per-locale rich text).
  - **Note tab** — TipTap editor (`Note` -> `packages/ui/.../editor`), content saved per-locale to `lesson_language.content`.
  - **Document tab** — `Document`: upload via `AddDocumentModal` (drag-drop one file; accepted pdf/doc/docx/ppt/pptx; max size from `getResolvedUploadLimits().documentBytes`, `UPLOAD_MAX_DOCUMENT_MB` default 5 MB; disabled if `$isFreePlan`). **"Content type" chips: Resource | Workbook | Case study** (`assignment` is hidden from the picker). If an assessment kind is picked: optional **Due date** (date input -> ISO `dueAt`) and **"Allow draft submissions"** checkbox (default on; `allowDrafts`). An assessment brief is always `downloadable: true`; a plain resource has a per-file "allow download" checkbox (default off = view-only). Upload: `POST /course/presign/document/upload` -> browser PUT to storage -> `mediaApi.registerUploadedLessonDocument` (assets table) -> appended to `lesson.documents` `{type,name,link,key,size,assetId,kind,downloadable,dueAt?,allowDrafts?}`. PDF in-page viewer (pdf.js from `/js/pdf.js/`), per-document delete (confirm modal). Labeled **Links** section: label + URL list (`lesson.links`).
  - **Video tab** — add via upload (HLS encode in browser, `media-uploader.ts`), YouTube link, Google Drive, library, embed link; per-video watch-enforce flag; transcript side panel.
  - **Slide tab** — single `slideUrl` embed.
  - **Settings tab (`LessonSettingsTab`)** — Live-session block only when `course.type == LIVE_CLASS` (Zoom/call URL, datetime-local + timezone select, Save; if an earlier session existed a confirm dialog "save and notify" -> `POST .../notify-session-update`); **Unit type** select (`No type` / Induction / ID check / Session / Portfolio review -> `lesson.unit_type`); **"Optional unit"** checkbox (`lesson.is_optional`: never blocks next unit, excluded from % complete); stock **Completion policy** select (manual / video_watch / none) + watch threshold % and per-video "enforced" checkboxes (stock leftover — learners no longer self-assert completion).
- **UI (learner view):** if the unit has tagged assessments a top amber banner "This unit has N assessment(s) to submit" with "Go to assessment" scroll button; materials rendered in tab order (Docs viewer, Note, Videos, Slides); optional `IdVerificationStatus` on `unitType=='id-check'`; then an **Assessments** section (`#assessments`) with a "Message your tutor ->" link to `/messages` and one `CourseworkSubmission` card per tagged doc (details below); lesson comments (`Comments`) only if `currentOrg.customization.apps.comments`. A hidden `unitTimeHeartbeat` action posts active-time while the learner views the unit.
  - **`CourseworkSubmission` card** (`course/components/lesson/coursework-submission.svelte`): header (name, kind label, "Due <date>", **Download brief** via presigned doc download), state banners ("Passed. No further submissions..." green; "Your work was referred - read the feedback, revise, and submit a new version" amber), if not passed: **Final (graded) / Draft (feedback only)** toggle (only when `allowDrafts`), drag-drop zone (`.pdf .doc .docx`, max 5 files, per-file max size from config, client validation via `courseworkApi.validateFiles`), selected-file list with remove, optional **comment** textarea (max 5000), buttons **Clear** and **Submit final / Submit draft**; below, **Your submissions** newest-first: "Version N", Draft/Final badge, result badge (Pass/Refer, "Draft feedback", or "Awaiting marking"/"Awaiting draft feedback"), date, file links (guarded download), learner comment, and **Tutor feedback** box (text + downloadable feedback files).
- **API calls:** `GET /course/:id/lesson/:lessonId` (+`GET .../language`, `GET .../language/:locale`; `requireCourseContentRead`), `PUT /course/:id/lesson/:lessonId` (admin; body title, isUnlocked, completionPolicy, videoWatchThreshold, slideUrl, videos, documents, links, unitType, isOptional, callUrl, lessonAt), `POST .../lesson/:lessonId/language` & `PUT .../language/:locale` (admin; rich text), `DELETE .../lesson/:lessonId` (admin), `POST .../notify-session-update`, `GET .../lesson/:lessonId/history` (version history; the button is commented out), `POST /course/presign/document/{upload,download}` and `/video/{upload,download}` (`routes/course/presign.ts`, `requireActor`; download is course-bound via `assertCourseMaterialDownloadAccess`), learner coursework: `GET/POST /course/:id/lesson/:lessonId/coursework`, `POST .../coursework/presign`, `POST .../coursework/download`, `GET .../coursework/:submissionId` (`routes/course/coursework.ts`; submit endpoints use `requireCourseworkSubmit`: role LEARNER + enrolled + course published + unit unlocked; per-assessment "already passed" and "drafts disabled" checks live in `services/coursework/coursework.ts#resolveSubmittableAssessment`), `PUT .../lesson/:lessonId/time` (heartbeat), `PUT .../watch-progress`, comments (`GET/POST .../comment`).
- **Data:** `lesson` (documents jsonb, links jsonb, videos, unit_type, is_optional, call_url, lesson_at), `lesson_language`, `lesson_language_history`, `assets`, `asset_usages`, `lesson_comment`, `coursework_submission`, `coursework_result`, `unit_time_spent`, `unit_time_monthly`, `lesson_video_progress`, `lesson_completion` (stock), `audit_event`, `notification`.
- **Wired?:** working. Stock completion-policy / watch-progress / "mark complete" controls are partly dead leftovers (learner self-completion hidden by PROGRESS-MODEL D2). The version-history drawer is commented out. `isFreePlan` upsell gates (uploads) are inherited plan logic that must be forced-open in prod.
- **Brand strings:** none hard-coded in the lesson route; the unlock hint and banner copy are plain English literals in components (not branded). Document viewer loads `/js/pdf.js/*`.

#### Exercise (stock quiz builder) — `/courses/[id]/exercises/[exerciseId]` (`+page.server.ts`, `+page.svelte`; UI `$features/course/pages/exercise.svelte`)
- **Roles:** `requireAdmin` in `+page.server.ts` -> **ADMIN only**; learners/tutors get 403 even though the API (`routes/course/exercise.ts`) lets any course member `GET` and submit. Code comment: "PearlLMS assessment is the coursework loop, not exercises."
- **Reached from:** outline row of an exercise, sidebar tree, `people/[personId]` exercise list, admin "Add content -> Exercise".
- **Purpose:** author/preview a stock ClassroomIO quiz (questions, sections, grading settings) and view submissions.
- **UI & actions:** header auto-graded / manual-grading-required badge; Admin toolbar: Add question (type picker), Add section, Edit/Preview toggle, Save, "..." menu (Reorder questions/sections via `order-modal`, "Notify learners" job, Delete exercise). Tabs **Questions | Settings | Submissions**. **Settings tab** (`exercise-settings-tab.svelte`): completion policy (submitted/passed), pass threshold %, slug, single-attempt vs retry guard dialog. **Question types** come from `packages/question-types/src/question-type-keys.ts`: RADIO, CHECKBOX, TEXTAREA, TRUE_FALSE, SHORT_ANSWER, NUMERIC, FILL_BLANK, FILE_UPLOAD, MATCHING, ORDERING, HOTSPOT, LINK, WORD_BANK, STAR, VIDEO_RECORDING, THUMBS (registry `question-type-registry.ts` flags autoGradable / manualGradingRequired; `premium-question-types.ts`; guide `packages/question-types/ADDING_A_QUESTION_TYPE.md`). Per question: title, optional description, image/video media, options, correct answers, points. Exercise/question state lives in `course/components/exercise/store.ts`.
- **API calls:** `GET /course/:id/exercise/:exerciseId`, `GET .../:exerciseId/submissions`, `POST /course/:id/exercise` and `/exercise/from-template`, `PUT/DELETE .../:exerciseId` (`courseTeamMemberOrAutomationKeyMiddleware(['course:exercise:write'])` — i.e. org admin or group role 1/2 or an automation key), `POST .../:exerciseId/submission`, video-recording upload init/complete/playback, `POST .../:exerciseId/notify` (+ `GET .../notify/:jobId`), exercise templates (`GET .../exercise/template*`).
- **Data:** `exercise`, `exercise_section`, `question`, `option`, `question_type`, `exercise_template`, `submission`, `question_answer`, `submissionstatus`.
- **Wired?:** upstream leftover. Fully functional for admin authoring but NOT part of the PearlLMS learner loop; learners cannot open it (page guard) so any exercise added to a course would appear in the learner outline/sidebar as a link that 403s. Do not replicate unless the new brand wants quizzes.
- **Brand strings:** none hard-coded.

#### Settings — `/courses/[id]/settings` (`+page.server.ts` `requireAdmin`, `+page.svelte`; UI `pages/settings.svelte`)
- **Roles:** ADMIN only (nav hidden for learners; server 403 for others).
- **Reached from:** Sidebar "Settings".
- **Purpose:** course-level configuration and publishing.
- **UI & actions:** one long form with sticky Save/Discard bar (`Page.SettingsActions`; manual save, "unsaved changes" label). Sections: Cover image (upload/replace/remove, Uploadcare-style widget `handleOpenWidget`); Course details (**title - required**, **description - required**; errors from i18n `snackbar.course_settings.error.*`); course link/slug (shown when published; generate new link); **Course type** select (SELF_PACED / LIVE_CLASS / COMPLIANCE / PUBLIC; conversions to PUBLIC can be blocked); welcome-email message textarea (`metadata.welcomeEmailMessage`); tags picker; lesson-tab order drag list (`metadata.lessonTabsOrder`); **content grouping** switch (`metadata.isContentGroupingEnabled`); **Sequential unlock** switch (`course.sequential_unlock`; PearlLMS Phase 4, copy: locked until previous session has a passing result, induction and ID-check always open, staff never gated); stock progression-mode radio (free/sequential, `metadata.progressionMode`); lesson download switch; course download (PDF) button; PUBLIC-only callout editor; "allow new students" switch; **Published** switch (publishing a COMPLIANCE course without a certificate deadline opens a dialog that sends you to Certificates settings); locked-content notice with "Unlock all"; Danger zone: delete course (confirm).
- **API calls:** `PUT /course/:id` (`requireAdmin`; `ZCourseUpdate`), `DELETE /course/:id` (`requireAdmin`), `PUT /course/:id/tags`, `POST /course/:id/download/content`, `PUT /course/:id/content` (unlock all), image upload via org upload endpoint.
- **Data:** `course` (title, description, type, logo, is_published, slug, sequential_unlock, metadata jsonb, callout), `tag_assignment`, `lesson.is_unlocked`.
- **Wired?:** working. Mixed: PearlLMS additions (sequential unlock) + many stock options irrelevant to a closed apprenticeship LMS (PUBLIC type, callout, slug/public link, lesson download, plan gates `$isFreePlan`).
- **Brand strings:** i18n only.

#### People (course roster) — `/courses/[id]/people` (`people/+layout.server.ts` `requireAdmin`; `+layout.svelte`, `+page.svelte`)
- **Roles:** ADMIN only (layout guard covers `people/` and `people/[personId]/`). Inner buttons additionally `RoleBasedSecurity [1,2]`.
- **Reached from:** Sidebar "People".
- **Purpose:** list and manage everyone in the course group; add tutors/learners.
- **UI & actions:** role filter select (ROLES from `lib/utils/constants/roles`: admin/tutor/learner), search, table (avatar, name, **obscured email** (`a***z@domain`), role, actions: copy email, delete (confirm `DeleteConfirmation`), "View" -> person page; pending invitees (no profile) show email + "Pending" chip). Header **"Add people"** button -> `?add=true` opens `InvitationModal` with tabs **Tutors** / **Students**: Tutors tab = multi-select of verified org team members not already on the course (`tutor-select-section.svelte`; adds group role 2 = the course->tutor assignment); Students tab = existing-student multi-select (search against org audience) with "notify" toggle and "Grant access", bulk-email box (paste emails; "send email" toggle; `orgApi.importAudienceMembers`), invite-link settings (preset, expiry, max uses), existing invites list with copy/revoke/audit trail. `?grantAccess=<email>` opens `GrantAccessModal` (send invite). `isStudentLimitReached` shows an UpgradeBanner (plan limit leftover).
- **API calls:** `GET/POST /course/:id/members`, `PUT/DELETE /course/:id/members/:memberId`, `POST .../members/:memberId/reset-progress`, `GET .../members/:userId/analytics` (all `requireAdmin`, `routes/course/people.ts`); invites `GET/POST /course/:id/invites`, `POST .../invites/:inviteId/revoke`, `GET .../:inviteId/audit` (`courseTeamMemberMiddleware`, `routes/course/invite.ts`); org audience import (`orgApi.importAudienceMembers`).
- **Data:** `groupmember` (role_id 1/2/3), `group`, `course_invite`, `course_invite_audit`, `organizationmember`, `profile`.
- **Wired?:** working, but note enrolling a learner here does NOT allocate a tutor; per-learner `tutor_allocation` is created elsewhere (Learner Management / `POST /organization/allocations`, Manager or Admin). Adding a tutor here is course->tutor (group role 2) only.
- **Brand strings:** invite emails/templates are outside this scope.

#### Person detail — `/courses/[id]/people/[personId]` (`people/[personId]/+layout.server.ts`, `+page.server.ts`, `+page.svelte`)
- **Roles:** ADMIN only (parent layout guard).
- **Reached from:** People table "View"; Analytics student table "View details" (`?back=` supported).
- **Purpose:** one learner's course analytics.
- **UI & actions:** hero profile card, three activity cards (overall course progress, assignment (exercise) completion %, average grade), exercise list with complete/incomplete filter badges, per-exercise score + graded/not-graded badge + links to the exercise and its lesson; header back arrow and **Reset progress** button (`ResetProgressButton` -> dialog with intro + progress impact; wipes the learner's course progress).
- **API calls:** `GET /course/:id/members/:userId/analytics?includeProgressImpact=true` (server load), `POST /course/:id/members/:memberId/reset-progress`.
- **Data:** `lesson_completion`, `submission`, `question_answer`, `exercise`, `lesson`.
- **Wired?:** stale for PearlLMS: metrics are the stock exercise/lesson-completion numbers; they do not reflect coursework Pass/Refer. Also leaves a `console.log` in the page. Use `/caseload/progression` for real progress.
- **Brand strings:** none.

#### Analytics — `/courses/[id]/analytics` (`+page.server.ts` `requireAdmin`; `pages/analytics.svelte`)
- **Roles:** ADMIN only (page); API itself is `courseTeamMemberMiddleware` (admin or group 1/2).
- **Reached from:** Sidebar "Analytics".
- **Purpose:** per-course KPI dashboard (stock).
- **UI & actions:** KPI tiles (students, lessons, progress/avg grade, exercises/completion rate), graph (`AnalyticsGraph`), student progress table (name, lessons completed, exercises submitted, average grade, last seen, "View details" -> person page); empty state if no data. Server-fetched, Refresh button re-runs load.
- **API calls:** `GET /course/:courseId/analytics` (`routes/course/course.ts:503`).
- **Data:** `lesson_completion`, `submission`, `groupmember`, `profile`, last-seen from analytics tables.
- **Wired?:** working but based on stock self-asserted completion + quiz grades; misleading for coursework-driven courses (upstream leftover).
- **Brand strings:** none.

#### Submissions (stock quiz grading board) — `/courses/[id]/submissions` (`+page.server.ts` `requireAdmin`; `+page.svelte`; UI `pages/submissions.svelte`)
- **Roles:** ADMIN only (page, `RoleBasedSecurity [1,2]`, API `requireMarkingAccess()`: ADMIN, or TUTOR only if a learner resolver passes — none is passed, so tutors are denied).
- **Reached from:** Sidebar "Submissions".
- **Purpose:** Kanban board for stock exercise (quiz) submissions.
- **UI & actions:** 3 columns by status id (1 Submitted, 2 In progress/Grading, 3 Graded; allowed transitions 1->2, 2->1, 2->3; drag-and-drop between columns, invalid transition shows snackbar); card opens `MarkExerciseModal` via `?submissionId=` (per-question points, feedback, save -> status Graded, delete submission, workflow hints "awaiting manual grading"/"failed"). The "Grade with AI" flag exists but AI is disabled.
- **API calls:** `GET /course/:id/submission/for-grading`, `PUT /course/:id/submission/:submissionId` (status), `PUT .../:submissionId/grades`, `PUT .../:submissionId/answer`, `DELETE .../:submissionId` (`routes/course/submission.ts`; `requireMarkingAccess()` + `bindSubmissionToCourse`).
- **Data:** `submission`, `submissionstatus`, `question_answer`, `exercise`.
- **Wired?:** upstream leftover; not used by the coursework loop. Replicator can drop.
- **Brand strings:** none.

#### Marks (gradebook) — `/courses/[id]/marks` (`+page.server.ts` `requireAdmin`; `pages/marks.svelte`)
- **Roles:** ADMIN only server-side. Nav shows only when `course.type == LIVE_CLASS` (admin always; learner only if `customization.course.grading`). `RoleBasedSecurity` page roles `[1,2]` (+3 if grading customization) but the server guard overrides for learners; API `GET /course/:id/mark/gradebook` and `/mark` are `requireMarkingAccess()` (admin only in practice).
- **Reached from:** Sidebar "Marks" (LIVE_CLASS only).
- **Purpose:** students x exercises grade matrix (stock).
- **UI & actions:** table of student rows, one column per exercise (percent tinted green >=90, blue >=80, amber >=70, red below), avg grade; CSV and PDF export (`generateMarksCSV/PDF` in `marks-utils.ts`); refresh.
- **API calls:** `GET /course/:id/mark/gradebook` (server load), `GET /course/:id/mark` (client store).
- **Data:** `submission`, `exercise`, `groupmember`.
- **Wired?:** upstream leftover; only meaningful for LIVE_CLASS quiz courses. Exports use `jspdf`.
- **Brand strings:** PDF title uses course title only.

#### Attendance — `/courses/[id]/attendance` (`+page.server.ts` `requireAdmin`; `pages/attendance.svelte`)
- **Roles:** ADMIN only; nav item requires `course.type == LIVE_CLASS`; API `POST /course/:id/attendance` is `requireStaff`.
- **Purpose:** mark learners present/absent per live-session lesson.
- **UI & actions:** grid of learners x lessons with a checkbox per cell; toggling upserts instantly and patches the local `courseApi.course.attendance`.
- **API calls:** `POST /course/:courseId/attendance` (`routes/course/attendance.ts`).
- **Data:** `group_attendance`.
- **Wired?:** working but unused (no LIVE_CLASS courses in the apprenticeship model).
- **Brand strings:** none.

#### Compliance — `/courses/[id]/compliance` (`+page.server.ts` `requireAdmin`; `pages/compliance.svelte`)
- **Roles:** ADMIN only for this page; nav item only for `course.type == COMPLIANCE`. Learners see a compliance status card in the course sidebar instead (`complianceApi.learnerHistory`). Team-level API endpoints use `courseTeamMemberMiddleware`.
- **Purpose:** recurring compliance cycles (due date, valid-until, score, attempts), reset/extend/waive.
- **UI & actions:** Tabs Overview / Learners; current cycle form, history table, learner table with reset cycle, extend due date, waive actions; empty state if course not COMPLIANCE.
- **API calls:** `GET /course/:id/compliance`, `GET .../compliance/learners/:profileId`, `POST .../compliance/{reset,extend,waive}` (`routes/course/compliance.ts`).
- **Data:** `course_completion_record`, `course_completion_notification_event`.
- **Wired?:** working stock feature; unused in PearlLMS. Name collision to remember: PearlLMS completion is `course_completion`, stock compliance is `course_completion_record`.
- **Brand strings:** none.

#### Certificates (settings) — `/courses/[id]/certificates` (`+page.server.ts` `requireAdmin`; `pages/certificates.svelte`)
- **Roles:** ADMIN only. Nav item HIDDEN for everyone (`CERTIFICATES_ENABLED=false`) — the route is reachable by URL for ADMIN only. Docs (PROGRESS-MODEL) state "no certificates, ever; issued off-platform".
- **Purpose:** certificate design + issuing rules.
- **UI & actions:** tabs Design / Settings (Settings only has the sticky save bar): downloadable toggle, theme (e.g. `classique`), design, completion threshold %, deadline, required exercise + min score %, certificate email message; save validates `ZCourseUpdate`; free-plan save opens upgrade modal; also an "Issue certificate" modal and reports components exist in `components/ceritficate/`.
- **API calls:** `PUT /course/:id` (`requireAdmin`), `GET /course/:id/certification-evaluation`, `POST /course/:id/download/certificate` (+`/png`) (`courseMemberMiddleware`).
- **Data:** `course.certificate` jsonb, `course_certificate_issue`.
- **Wired?:** upstream leftover (hidden). Loads Google Fonts `Qwitcher Grypen` and `Roboto` from fonts.googleapis.com.
- **Brand strings:** Google Fonts links; i18n only.

#### Certificate editor — `/courses/[id]/certificates/editor` (`+page.server.ts` `requireAdmin`; `+layout@(app).svelte` resets to the (app) layout so it is full-screen; `+page.svelte`)
- **Roles:** ADMIN only; hidden (see above).
- **Purpose:** canvas-style certificate template editor.
- **UI & actions:** loads course via `courseApi.ensureCourse`, renders `CertificateEditor` (`components/ceritficate/editor/certificate-editor.svelte`).
- **API calls:** `PUT /course/:id` (design saved in `course.certificate.design`).
- **Data:** `course`.
- **Wired?:** upstream leftover (hidden).
- **Brand strings:** none found in this route; check `components/ceritficate/` mock data (`mockData.ts`) and certificate themes when rebranding.

#### Landing page builder — `/courses/[id]/landingpage` (`+page.server.ts` `requireAdmin`; `+page.svelte`)
- **Roles:** ADMIN only; nav item hidden from learners; the API `PUT /course/:id/landing-page` is only `courseTeamMemberOrAutomationKeyMiddleware(['course:write'])` (NOT admin-only: a course-team tutor or automation key can write it; the dashboard page itself is admin-only).
- **Purpose:** edit the public course sales page (stock; irrelevant to a closed invite-only deployment).
- **UI & actions:** full-screen overlay (fly-in) with collapsible left editor sidebar (sections: header/hero, requirements, description, goals, chips/skills & tools, certificate, curriculum, instructor, reviews, pricing) and live preview `CourseLandingPage editMode`; select a section in the preview or sidebar to edit; Save; close returns to `/courses/:id`.
- **API calls:** `PUT /course/:id` (`courseApi.update`), `PUT /course/:id/landing-page`.
- **Data:** `course` (landing fields, reviews, pricing, certificate), `currency`.
- **Wired?:** working stock feature; unused (no public catalog; LANDING_PAGE_ENABLED=false for org-level).
- **Brand strings:** i18n only.

#### AI Tutor settings — `/courses/[id]/ai-tutor` (`+page.server.ts` `requireAdmin`; `+page.svelte` -> `$features/ai-tutor-settings` `CourseAiTutorSettingsPage`)
- **Roles:** ADMIN only; nav item HIDDEN (`AI_ENABLED=false`); route reachable by URL.
- **Purpose:** per-course AI tutor override (inherit from org or custom prompt/limits).
- **UI & actions:** "inherit from org" switch + override form, Save/Discard bar.
- **API calls:** `GET/PUT /course/:id/ai-tutor` (`routes/course/ai-tutor.ts`, `courseTeamMemberMiddleware`).
- **Data:** `ai_tutor_message_count`, `ai_tutor_cap_event`, course/org AI settings jsonb.
- **Wired?:** dead (feature-flagged off). Drop or keep disabled.
- **Brand strings:** none found.

---

### B. Tutor shell and `caseload/**`

All caseload pages: `requireStaff(locals)` (ADMIN or TUTOR; Learner and Manager get 403). API is mounted at `/caseload` (`apps/api/src/routes/caseload/caseload.ts`), every endpoint `requireStaff`, and services re-check scope. Scope rules: a TUTOR's roster = learners in `tutor_allocation` for that tutor only (`listLearnersForTutor`, "allocation only"); ADMIN roster = org-wide. **Exception to note:** the course-view/grid services (`resolveRoster` in `apps/api/src/services/caseload/course-view.ts`) additionally let a *course-team TUTOR* (group role 2, `isCourseTutor`) see EVERY enrolled learner of that course.

#### Tutor shell — `/caseload` layout (`+layout.server.ts`, `+layout.svelte`)
- **Roles:** ADMIN, TUTOR.
- **Reached from:** post-login redirect for TUTOR (`homeForRole`), `init.svelte.ts` also forces tutors here; admin by URL.
- **Purpose:** tutor app frame.
- **UI & actions:** `TutorSidebar` (org logo `$currentOrg.avatarUrl || /logo-192.png` + org name + "Tutor"; nav: Dashboard `/caseload`, My Courses `/caseload/courses`, Messages `/caseload/messages`, Learner Progression `/caseload/progression`; footer user name/email + `SidebarLogoutButton`), top bar with sidebar trigger and `NotificationBell`, content max width 6xl.
- **API calls:** notifications bell (`/notifications` endpoints, outside scope).
- **Data:** `notification`, `profile`, `organization`.
- **Wired?:** working.
- **Brand strings:** fallback logo `/logo-192.png`; "Tutor" label; no product name (org name from DB).

#### Caseload dashboard (tutor home) — `/caseload` (`+page.server.ts`, `+page.svelte`; UI `caseload/pages/caseload.svelte`)
- **Roles:** TUTOR (own roster), ADMIN (org-wide roster).
- **Reached from:** login, sidebar Dashboard, logo.
- **Purpose:** grading pipeline overview.
- **UI & actions:** `BroadcastBanner` + "Welcome back, <first name>" + Announcements list (tutor-addressed broadcasts); 4 KPI tiles (Your Learners with Active/Inactive/Never-in badges; Courses + Assignments; Awaiting Marking + Resubmissions; Grading Stats: total graded, pass rate %, avg turnaround days); 5 clickable secondary tiles (Overdue (>72h SLA), Due Within 3 Days, Inactive 30+ days, Awaiting Draft Feedback, Learners With Pending Work); charts `ActivityPie` (active/inactive/never logged in/suspended) and `OutcomesDonut` (Pass vs Refer); "Grading Pipeline" table (Metric / Count / View); "Programmes & Caseload" table (programme, learners); drill-down panel (toggle, smooth-scroll) listing queue items (Learner, Course, Assignment name + unit + vN, Submitted date + days waiting, Draft/Final badge, View -> `/caseload/:learnerId`) or the learner roster (Learner, Email, Submissions, View).
- **API calls:** `GET /caseload` (roster + awaiting), `GET /caseload/pipeline` (stats + queues + programmes), announcements feed (`announcementsApi.loadFeed`).
- **Data:** `tutor_allocation`, `coursework_submission`, `coursework_result`, `profile` (status), `announcement`, last-seen from analytics; SLA from env `MARKING_SLA_HOURS` (default 72) and `DUE_SOON_WINDOW_DAYS`=3.
- **Wired?:** working.
- **Brand strings:** `<title>Caseload — Pearl LMS</title>` (`+page.svelte:6`).

#### Caseload learner detail — `/caseload/[learnerId]` (`+page.server.ts`, `+page.svelte`; UI `caseload/pages/learner-detail.svelte`)
- **Roles:** ADMIN, or TUTOR **allocated to that learner** (API `GET /caseload/learners/:learnerId` -> 403 "This learner is not in your caseload" otherwise; pasting another tutor's learner id is denied server-side).
- **Reached from:** dashboard queue/roster "View".
- **Purpose:** one learner's full submission history, quick marking, messaging, ID verification.
- **UI & actions:** back link; name/email; **Message** button (`messagingApi.open(learnerId)` then `goto /messages/:threadId`); `IdVerificationControl` (record the learner's ID check; no document stored); per course -> per unit cards (unit title + state badge "Awaiting marking"/Pass/Refer) -> every submission version (assessment name, vN, Draft/Final badge, result badge or "Draft feedback sent", date, file buttons with size, learner-visible feedback). The latest unmarked version per (assessment, type) shows an inline **MarkingForm**: Result select (Pass/Refer, finals only), Feedback textarea (required non-empty for drafts), button "Save result" or "Send draft feedback". Files open via the guarded coursework download.
- **API calls:** `GET /caseload/learners/:learnerId`, `POST /caseload/submissions/:submissionId/result` body `{result?, feedback?, feedbackFiles?}` (201), `POST /course/:courseId/lesson/:lessonId/coursework/download` (file open; `assertCourseworkDownloadAccess` -> `canReadCoursework`: self / allocated tutor / admin; Manager denied), messaging `POST` thread open, ID-verification endpoints.
- **Data:** `coursework_submission`, `coursework_result`, `lesson`, `profile`, `tutor_allocation`, `message_thread`, `id_verification`, `audit_event` (`result.entered`).
- **Wired?:** working. This is the only place a quick-mark form without feedback files exists; the richer drawer is on the submissions grid.
- **Brand strings:** `<title>Learner — Pearl LMS</title>`.

#### My Courses — `/caseload/courses` (`+page.server.ts`, `+page.svelte`)
- **Roles:** TUTOR, ADMIN.
- **Reached from:** sidebar.
- **Purpose:** course grid for the tutor.
- **UI & actions:** search box; `CourseCard` per programme (title, "N learners", "Open ->") linking to `/caseload/courses/:courseId`; empty state "Courses appear here once learners are allocated to you." Built from `pipeline.programmes` (allocation-derived), so a course-team tutor with zero allocated learners sees an empty list yet could still open a course by URL.
- **API calls:** `GET /caseload/pipeline`.
- **Data:** `tutor_allocation`, `groupmember`, `course`.
- **Wired?:** working.
- **Brand strings:** `<title>My courses — Pearl LMS</title>`.

#### Tutor course view (units overview) — `/caseload/courses/[courseId]` (`+page.server.ts`, `+page.svelte`)
- **Roles:** ADMIN; TUTOR if they have allocated learners enrolled in the course OR are on the course team (`resolveRoster`); otherwise 403 "You are not assigned to this course". Read-only.
- **Reached from:** My Courses card; units sidebar "All units"; submissions grid "Course" back link.
- **Purpose:** ordered unit list with grading counts.
- **UI & actions:** title + "N participants"; flat list of units, each a link to its unit page showing title, unit-type badge, "Optional" badge, "X materials · Y assessments", amber "N need grading" pill.
- **API calls:** `GET /caseload/courses/:courseId/content` (`getTutorCourseContent`).
- **Data:** `course`, `course_section`, `lesson` (documents), `coursework_submission`, `coursework_result`, `tutor_allocation`, `groupmember`.
- **Wired?:** working.
- **Brand strings:** `<title>{course title} — Pearl LMS</title>`.

#### Tutor unit view — `/caseload/courses/[courseId]/units/[lessonId]` (`+page.server.ts`, `+page.svelte`)
- **Roles:** same as course view (`getTutorUnitContent`; unit must belong to the path course else 404).
- **Reached from:** unit list rows, units sidebar.
- **Purpose:** read-only, learner-like view of one unit with a link into each assessment's grid.
- **UI & actions:** left `UnitsSidebar` (sticky ordered unit list, active highlight, optional badge "Opt", amber dot when work awaits grading, "All units" link); right pane: title + unit-type/Optional badges; sections **Videos** (YouTube iframe embed, else outbound link), **Notes** (`{@html unit.note}` of admin-authored HTML), **Materials** (resources + external links; resource click = allocation-gated presigned download), **Assessments** (card per tagged doc: name, kind badge, due date, stat badges "N submitted", "N need grading", "N passed", buttons **View submissions** -> `/caseload/courses/:courseId/submissions?lessonId=&assessmentKey=` and **Download brief**). Empty state "Nothing here yet".
- **API calls:** `GET /caseload/courses/:courseId/content` (outline/stats), `GET /caseload/courses/:courseId/lessons/:lessonId/unit`, `POST /caseload/courses/:courseId/materials/download` (every key must be a real document key of this course, else 403).
- **Data:** `lesson`, `lesson_language`/note, `course_section`, `coursework_*`.
- **Wired?:** working.
- **Brand strings:** `<title>{unit} — Pearl LMS</title>`.

#### Submissions grid + grading drawer — `/caseload/courses/[courseId]/submissions?lessonId=&assessmentKey=` (`+page.server.ts`, `+page.svelte`, `caseload/components/grading-drawer.svelte`)
- **Roles:** ADMIN; TUTOR per roster rule (allocated learners enrolled in the course, or all enrolled for a course-team tutor). Roster of a plain tutor = own allocated learners only ("Separate groups"). **Gap:** for a course-team tutor, rows for non-allocated learners show a Grade button, but `recordResult` (`services/coursework/marking.ts`) requires ADMIN or `isAllocatedTutor` -> 403 on save; file downloads for those learners are also refused by `canReadCoursework`.
- **Reached from:** unit view "View submissions".
- **Purpose:** Moodle-style marking table for ONE assessment.
- **UI & actions:** header (assessment name, kind badge, unit title, due date); 6 summary tiles (Participants, Submitted, Needs grading, Passed, Referred, Due date); toolbar: search (name/email/username/ID number), status filter (All, Not submitted, Draft, Awaiting marking, Draft feedback, Referred, Passed), counts, **Download all** (zip of every roster learner's latest submission). Table (17 columns, sticky name column): expand chevron, Name, Username, ID number, Email, Status (No submission / Draft / Draft feedback / Submitted for grading / Referred / Graded-Pass), Allow submissions from (enrolment date), Due date, Grade, Last modified (submission), File submissions (download links), Submission comments (learner comment), Last modified (grade), Feedback files, Feedback comments, Final grade, Actions (**Grade** button disabled unless the row has a `gradeTargetId` i.e. an unmarked latest final or unmarked draft; **History (N)**). Expanded row lists every version: vN badge, draft/final, date, result, files, feedback text, feedback files, "Graded by X · date".
  - **Grading drawer** (right Sheet "Grade submission"; subtitle name · Draft/Final · Version N): learner files list, learner comment, for FINAL a **Result** button pair (Pass / Refer; default Pass because `RESULT_VALUES[0]`), for DRAFT the hint "Drafts receive feedback only", **Feedback** textarea (placeholder differs; empty draft feedback with no files blocked client-side), **Attach marked-up file** (multiple `.pdf .doc .docx`, uploaded via `POST /caseload/submissions/:id/feedback/presign` then PUT), Cancel / "Save result" or "Send draft feedback". On success the grid reloads.
- **API calls:** `GET /caseload/courses/:courseId/lessons/:lessonId/submissions?assessmentKey=` (`getAssessmentSubmissions`), `GET .../submissions/download-all?assessmentKey=` (zip, `buildAssessmentSubmissionsZip`), `POST /caseload/submissions/:submissionId/feedback/presign` (`ZFeedbackPresign`, ≤10 files; keys under `coursework-feedback/...`), `POST /caseload/submissions/:submissionId/result` (`ZMarkSubmission`: `result` enum PASS/REFER optional, `feedback` max 5000, `feedbackFiles` max 10), file open via `POST .../coursework/download`.
- **Data:** `coursework_submission` (files jsonb, comment, submission_type, version, status), `coursework_result` (kind, result, feedback, feedback_files, recorded_by, recorded_at; UNIQUE per submission), `lesson.documents`, `groupmember`, `profile`, `learner_profile` (idNumber), `audit_event`, `notification`, `course_completion`.
- **Server rules (`recordResult`):** ADMIN or allocated tutor; FINAL must carry a verdict, DRAFT must carry non-empty feedback and no verdict; feedback file keys must start with that submission's feedback prefix; one result per version (409 "already been marked"); only the latest version of the same (assessment, type) is markable (409 "newer version has been submitted"); result row and (on PASS) the course-completion check are one DB transaction; audit `result.entered` (never feedback text); emails/notifications: learner "resulted" email, `session.unlocked` in-app notification for units newly opened by a PASS.
- **Wired?:** working (newest, most-used tutor screen).
- **Brand strings:** `<title>{assessment} — Pearl LMS</title>`.

#### Messages inbox — `/caseload/messages` (`+page.server.ts`, `+page.svelte`)
- **Roles:** ADMIN, TUTOR; API enforces participant-only per thread.
- **Reached from:** sidebar Messages; learner detail Message button; learner "Message your tutor".
- **Purpose:** list conversations (one row per learner), newest first.
- **UI & actions:** rows with unread dot, counterpart name, "Archived" badge, last body preview, relative time; click -> `/messages/[threadId]` (the thread/reply UI lives in a separate route outside this scope).
- **API calls:** `messagingApi.loadConversations` (`/messages`-style endpoints in `routes/comms`, outside this scope).
- **Data:** `message_thread`, `message`, `message_read`.
- **Wired?:** working.
- **Brand strings:** `<title>Messages</title>` only.

#### Learner Progression — `/caseload/progression` (`+page.server.ts`, `+page.svelte`; UI `caseload/pages/progression.svelte`)
- **Roles:** TUTOR (own allocated roster), ADMIN (org-wide).
- **Reached from:** sidebar.
- **Purpose:** filterable progress table with per-learner drill-down and export.
- **UI & actions:** filters: Activity Status (All/Active/Inactive/Created; "inactive" = last seen over 30 days, "created" = never logged in), Progression band (0-25/26-50/51-75/76-100 %), Course (server re-fetch; scopes metrics to that course), search by name, page-size 10/25/50/100 with pagination, Reset filters; export **CSV** (papaparse) and **PDF** (jspdf + autotable, title "Learner Progression"); rows: learner, start date (earliest enrolment), activity badge, current % of the target course (the chosen course, else the learner's primary course), current unit index, Workbooks "x / y Passed", Case Studies "x / y Passed"; expanding a row lazy-loads per-course detail: percent, workbook/case-study counts, total time, per-unit time (`formatSeconds`) and each submission (assessment, kind, document, submitted/marked dates, status Pass/Refer/Draft feedback/other) with document open buttons.
- **API calls:** `GET /caseload/progression?courseId=`, `GET /caseload/progression/:learnerId` (re-checks roster membership), file open via coursework download.
- **Data:** `tutor_allocation`, `groupmember`, `coursework_*`, `unit_time_spent`, `profile`, last-seen analytics, `lesson.documents` (kind), computed via `computeLearnerCourseProgress`.
- **Wired?:** working.
- **Brand strings:** `<title>Learner Progression — Pearl LMS</title>`, PDF heading "Learner Progression".

---

### C. Brand strings to replace for "Gecko Programmes" (in scope files)

| Where | String / asset |
|---|---|
| `<title>` of all `caseload/**` pages | "… — Pearl LMS" (`caseload/+page.svelte`, `[learnerId]`, `courses`, `courses/[courseId]`, `…/submissions`, `…/units/[lessonId]`, `progression`) |
| `courses/[id]/+layout.svelte:169` | fallback title `'Integer Training LMS Course'` |
| `$features/ui/powered-by.svelte` + `packages/ui/src/custom/public-course/*powered*.svelte` | learner/admin course sidebar footer "Powered by <brand>" linking to `https://classroomio.com?utm_*`, `alt="ClassroomIO"`, default prop `brand='ClassroomIO'`, image `/logo-192.png`; the brand text comes from i18n `public_course.powered_by.brand` = "Integer Training LMS" (en.json, also da/de); the free-plan floating chip hard-codes "Integer Training LMS" and `https://classroomio.com` |
| `caseload/components/tutor-sidebar.svelte` | `/logo-192.png` fallback avatar |
| `courses/[id]/certificates/+page.svelte` | Google Fonts (Qwitcher Grypen, Roboto) |
| `$lib/utils/translations/{en,da,de}.json` | all `course.*`, `aiTutor.*`, `analytics.*` copy (any "ClassroomIO"/"Integer Training" wording) |
| Unit/assessment copy | plain-English literals in `coursework-submission.svelte`, `grading-drawer.svelte`, `lesson.svelte` assessment banner (no product name) |
| Email links/templates | outside scope (see apps/api services/coursework/notifications.ts, packages/email) |

---

### D. End-to-end flows

#### 1. Admin builds a course with lessons + coursework units + assigns a tutor
1. Admin signs in -> `/org/{siteName}/dash`. Courses list (org area, outside this scope) -> **New course** (title, description, type; PearlLMS uses SELF_PACED). `POST /course` (`requireAdmin`). Course is created **unpublished** (`course.is_published=false`).
2. Course shell opens at `/courses/:id` (news feed or redirect to Lessons). Go to **Settings**: confirm title/description (both required), choose type, switch **Sequential unlock** ON if gated delivery is wanted, leave "content grouping" ON (phases), Save (`PUT /course/:id`).
3. **Lessons** page -> "Add content": first create **Sections** (phases; `POST /course/:id/section`), then **Lessons** (units; title + target section; `POST /course/:id/lesson`; new lessons go to the end of their phase). Use **Start reorder** -> drag within/between phases -> **End reorder** (persists `course_section.order` / `lesson.order` via the reorder endpoints).
4. Open each unit -> pencil (edit mode). **Settings tab**: set **Unit type** (Induction / ID check for exempt units; Session; Portfolio review) and **Optional** if it must not block. **Note tab**: write rich text. **Document tab**: upload the brief; choose **Content type**: *Resource* (reference, optional per-file download) or *Workbook* / *Case study* (assessment: optional due date, "Allow draft submissions"). Add labeled **Links**. Video/Slide tabs as needed. Autosaves; leaving edit mode saves.
5. **Publish**: Settings -> Published switch -> Save (slug generated). Learners cannot read draft courses (`requireCourseContentRead`).
6. **Enrol learners**: People -> Add people -> Students tab (existing org students, bulk email paste, or invite link) -> `groupmember` role 3.
7. **Assign tutor**: two distinct mechanisms. (a) Course->tutor: People -> Add people -> Tutors tab (multi-select org team members) -> `groupmember` role 2 = course-level access (sees all enrolled learners' grids/outline on `/caseload/courses/:id`, but cannot mark non-allocated learners). (b) Per-learner allocation (the one that grants marking + learner detail + caseload roster): Manager/Admin allocates tutor<->learner (`tutor_allocation`, via org Learner/Tutor Management, `POST /organization/allocations`; outside this scope). The tutor's roster, dashboard queues and marking all hinge on (b).

#### 2. Learner submits a unit (draft -> submit)
1. Learner signs in -> `/lms` -> opens course -> `/courses/:id/lessons` outline (locked units shown with lock icon + "Locked - complete X first", driven by `GET /course/:id/unlock`). Open an unlocked unit `/courses/:id/lessons/:lessonId` (server returns 403 for a locked one -> locked notice).
2. Read Docs/Note/Videos; an amber banner says the unit has assessment(s). The heartbeat records active time.
3. In the **Assessments** card: **Download brief** (presigned, course-bound). Choose **Draft (feedback only)** (only if the author enabled drafts) or **Final (graded)**; add up to 5 PDF/Word files (size limit from config, client + server validated), optional comment (<=5000).
4. Submit: `POST …/coursework/presign` (server computes next version for learner+lesson+assessment and learner-scoped keys `coursework/{courseId}/{learnerId}/{lessonId}/…`) -> browser PUTs files to the private bucket -> `POST …/coursework` registers a `coursework_submission` row (status `submitted`, `submission_type` draft|final, `version`). Guard: LEARNER, enrolled, published, unit unlocked; rejected if the assessment is already passed or drafts are disabled; keys must match the learner's own prefix (409 on version collision). Audit `coursework.submitted` (ids/counts only). Email to the learner's **allocated** tutor(s) ("submitted"; none sent if none allocated).
5. Card now shows the new version as "Awaiting marking" (final) or "Awaiting draft feedback" (draft). Drafts never gate anything and never count as a verdict.

#### 3. Tutor marks Pass/Refer with feedback
1. Tutor lands on `/caseload`: KPI tiles + "Awaiting Marking" / "Awaiting Draft Feedback" / "Resubmissions" / "Overdue (>72h)" queues; click View -> `/caseload/:learnerId` (quick form) **or** navigate My Courses -> course -> unit -> **View submissions** -> grid.
2. Open the grid row's **Grade** (enabled only for an unmarked latest version) -> drawer: view files and learner comment (files via guarded download).
   - Final: choose **Pass** or **Refer**, write feedback, optionally **Attach marked-up file** (feedback files uploaded under `coursework-feedback/...`), **Save result**.
   - Draft: write feedback (required unless files attached), **Send draft feedback** (no verdict).
3. `POST /caseload/submissions/:id/result`: server enforces allocation (or admin), type/verdict pairing, latest-version-only, one-result-per-version; inserts `coursework_result` (kind verdict|draft) in a transaction; on PASS also evaluates course completion in the same transaction; audit `result.entered`; learner email "result available" (status text only, no feedback); on PASS emits in-app `session.unlocked` for units newly opened.
4. Grid/learner detail refresh: row state -> Passed (green) / Referred (red) / Draft feedback.

#### 4. Learner resubmits
1. Learner opens the unit again: the card shows the amber "referred - revise and submit a new version" banner (for a Refer) with the tutor's feedback and any feedback files (downloadable). Upload area stays open as long as the latest final is not a PASS.
2. Submit again (draft and/or final): server assigns `version = previous + 1` (drafts and finals share one version sequence per assessment). History is kept (rows never deleted); the card lists every version newest-first.
3. Tutor's queue shows it under **Resubmissions Awaiting Review** (latest final unmarked AND a prior final was Referred); only the newest version of that (assessment, type) can be marked, so an older unmarked version returns 409.
4. A PASS on the latest final closes that assessment's uploads (`isAssessmentUploadClosed`).

#### 5. Progression, unlock and certificate
1. **Pass definition**: `hasLearnerPassedUnit` = every tagged assessment in the unit has a passing latest FINAL verdict (latest marked version; a later Refer overrides an earlier Pass); a unit with no tagged assessments falls back to the legacy per-unit rule.
2. **Unlock**: with `course.sequential_unlock=ON`, a non-exempt unit opens only when the nearest preceding gating unit is passed; induction/id-check/optional units are transparent and always open; computed live (`isUnitUnlocked`, one authority) and enforced on lesson GET, language GET, coursework presign/create and material download; staff never gated. After a PASS the learner gets an in-app `session.unlocked` notification; the outline lock map (`GET /course/:id/unlock`) refreshes.
3. **Progress/completion**: learner sidebar shows result-derived passed/total over non-exempt, non-optional units (`GET /course/:id/learner-progress`). When the last required unit passes, `recordCompletionIfComplete` inserts a `course_completion` row (UNIQUE learner+course, idempotent, audit `completion.recorded`) inside the marking transaction. A later Refer would un-complete by the live rule although the dated record remains.
4. **Tutor/Manager/Admin visibility**: tutor `/caseload/progression` (per-learner %, workbooks/case studies passed, time-in-unit, exports); manager `/reports` and admin dashboards (outside this scope).
5. **Certificate**: NOT issued by the platform in this fork. `CERTIFICATES_ENABLED=false` hides the nav; the stock certificate settings/editor routes under `courses/[id]/certificates*` remain (ADMIN by URL) but are decoupled from the PearlLMS completion record; certificates are produced off-platform manually.

#### Surprises / watch-outs
- Admin has no marking UI under `courses/[id]`; marking happens only under `/caseload/**`. `courses/[id]/{submissions,marks,analytics,people/[personId]}` run on the stock quiz/self-completion model and are stale for coursework-driven courses.
- Exercises: admin can still create them and learners then get a 403 on open (page guard) — a dead path.
- `PUT /course/:id/landing-page` and exercise write endpoints accept course-team tutors (not admin-only) even though their dashboard pages are admin-only.
- Course-team tutors can see all enrolled learners' grids but cannot grade or download them (allocation required), and `/caseload/courses` lists only allocation-derived courses.
- Course "Powered by" attribution still links to classroomio.com with a ClassroomIO alt text; titles still say "Pearl LMS".
- Two parallel lock concepts (sequential_unlock vs progressionMode/isUnlocked) and two completion tables (`course_completion` vs `course_completion_record`).


---

# Appendix C — Learner, auth, invites, public site

## 13 - Learner area, auth routes, invite pages, public org site, secondary apps

Source repo: `C:\Users\PC\Projects\LMSclassroom` (PearlLMS = hard fork of ClassroomIO). All paths below are repo-relative. READ-ONLY survey, code-verified 2026-10-27 (not live-tested).
Dashboard route root: `apps/dashboard/src/routes/` (abbreviated `routes/`). Feature code: `apps/dashboard/src/lib/features/` (abbreviated `features/`).

Conventions: "API" means the Hono app in `apps/api/src` reached from the browser through the dashboard SSR proxy (`/proxy/*` and `/api/auth/*`, see `apps/dashboard/src/lib/utils/proxy-api-request.ts`) and from SvelteKit server loads with an API key (`getApiKeyHeaders()`).

### Cross-cutting facts that apply to every entry

- **Deployment mode:** prod is built with `PUBLIC_IS_SELFHOSTED=true` (baked into the client bundle at build, `docker-compose.deploy.yaml` dashboard build arg). That makes `getOrgSiteInfo()` (`features/app/layout-setup.ts`) treat the single org as the "org site" on every request, so `isOrgSite` is always true. Consequence: the public `(org-site)` routes work on the main domain, the footer "Docs / Need help" items (shown only when `!isOrgSite`) are hidden, and the org-switcher is hidden.
- **Feature flags** are compile-time constants, not env vars: `apps/dashboard/src/lib/utils/constants/features.ts` (`EXPLORE_ENABLED`, `COHORTS_ENABLED`, `COMMUNITY_ENABLED`, `CERTIFICATES_ENABLED`, `AI_ENABLED`, etc., all `false`). Changing them needs a rebuild. Each hidden page keeps its code but its `+page.ts` / `+layout.ts` `load` does `redirect(303, '/lms')`.
- **Role home** (`lib/utils/functions/routes/homeForRole.ts`): Admin -> `/org/{siteName}/dash`, Tutor -> `/caseload`, Manager -> `/reports`, Learner (and unknown) -> `/lms`.
- **Auth gate** is layered: (1) `hooks.server.ts` redirects anonymous non-public paths to `/login?redirect=...` (public list = `PUBLIC_ROUTES` in `lib/utils/constants/routes.ts`); (2) `routes/(app)/+layout.server.ts` calls `requireActor(locals)` (live, ACTIVE, role-resolved actor); (3) the API is the authoritative boundary (`resolveActor`, deny-by-default; deactivated user denied everywhere).
- **Roles in the system:** ADMIN=1, TUTOR=2, LEARNER (code name STUDENT)=3, MANAGER=4 (`packages/utils/src/constants/roles.ts`).
- **Brand string inventory (global):** the product name shown to users is mostly **"Integer Training LMS"** (84 source files; every `<title>` on learner/auth pages, auth card avatar fallback, onboarding header, forgot/reset emails, "Powered by" brand). **"Pearl LMS"** appears in `<title>` of staff pages (caseload, admin dashboard, users, allocation, welcome) and in one learner dialog sentence ("only the Pearl admin team sees it"). Localstorage keys are `pearl.*`. Logo is `apps/dashboard/static/logo-192.png` (+ `logo-16/32.png`, `favicon.ico`) and the org's `avatarUrl` (DB). **"ClassroomIO" / classroomio.com** survives in: footer help mailto `help@classroomio.com` (`features/ui/sidebar/footer/menu.svelte:27`, hidden in prod), `verify-email-error` support mailto, `+error.svelte` / `404` links to `https://classroomio.com`, `lib/utils/translations/*.json`, the email base template (`packages/email/src/templates/default.ts`: masthead image `https://brand.cdn.clsrio.com/cio-bg-transparent.png`, footer links to classroomio.com/tos/privacy), email defaults (`packages/email/src/utils/constants.ts:38-39`, From `notify@mail.classroomio.com`, overridden by `SMTP_SENDER`/`SMTP_REPLY_TO`), forgot-password email (support address `help@classroomio.com`), `localeCookie` name `classroomio_locale`, auth cookie prefix `classroomio` (`packages/db/src/auth.ts`), twitter handle `@classroomio` in org-site meta tags, `static/classroomio-opengraph-image*.png`, and the default source-repo URL `https://github.com/Integer-Training/LMSclassroom`. The stale inventory in `docs/TODO-BRANDING.md` pre-dates the "Integer Training LMS" rename; trust a fresh grep.

---

## Learner navigation map

Layout chain for everything under `/lms`: `routes/+layout.svelte` (root: snackbar, pending-invite modal, theme, meta tags) -> `routes/(app)/+layout.svelte` (verify-email modal, upgrade modal, impersonation banner, command palette, 60s heartbeat to `POST /account/heartbeat`) -> `routes/(app)/lms/+layout.svelte` (LMS sidebar + header + tutor-feedback dialog).

**Sidebar (learner) - built from `features/ui/navigation/lms-navigation.ts`, `features/ui/sidebar/lms-sidebar/`:**

| Label (en.json key) | URL | Visible to learner? |
|---|---|---|
| Home (`lms_navigation.home`) | `/lms` | yes |
| My Learning | `/lms/mylearning` | yes |
| Certificates | `/lms/certificates` | **HIDDEN** (`CERTIFICATES_ENABLED=false`) |
| Explore | `/lms/explore` | **HIDDEN** (`EXPLORE_ENABLED=false`) |
| Cohorts | `/lms/cohorts` | **HIDDEN** (`COHORTS_ENABLED=false`) |
| "Exercise" (`lms_navigation.exercise`; page itself titled "Assessments") | `/lms/exercises` | yes (self-hosted always shows it: `PUBLIC_IS_SELFHOSTED==='true' \|\| org.customization.dashboard.exercise`) |
| Community | `/lms/community` | **HIDDEN** (`COMMUNITY_ENABLED=false` AND org customization `dashboard.community`) |
| Settings | `/lms/settings/notifications` | yes (link target is Notifications; `/lms/settings` and `/lms/settings/integrations` both redirect there) |

Sidebar header = org logo + org name (`features/ui/sidebar/org-sidebar/org-logo.svelte`, links to `$basePath`); sidebar footer = account dropdown (avatar, theme toggle, Log out; Whats-new / Feedback / Docs / Need-help items only when `!isOrgSite`, so hidden in prod) plus a standalone "Log out" button -> `/logout`.
**Header** (`features/ui/navigation/lms-header.svelte`): sidebar trigger, breadcrumbs, global search (`scope="lms"`), notification bell (`features/notifications/components/notification-bell.svelte`: unread badge, 60s poll, list, mark read / mark all read).
**Not in the sidebar but learner-reachable** (documented by another agent): `/messages`, `/messages/[threadId]` (Inbox button, Contact Tutor, Recent Messages card, bell notifications, "Message your tutor" link on a unit), `/announcements`, `/courses/[id]/lessons`, `/courses/[id]/lessons/[lessonId]`, `/change-password` (forced). The sidebar has NO Messages or Announcements entry.
**Retired redirects:** `/` (anon -> `/login`, authed -> role home), `/home` and `/welcome` (-> role home), `/signup` (308 -> `/register`).

---

## A. Learner area `(app)/lms/**`

#### Learner shell and layout popups - `routes/(app)/lms/+layout.svelte`
- **Roles:** any authenticated ACTIVE member (the `(app)` group guard); the sidebar/page set is learner-oriented but Admin/Tutor/Manager can also load `/lms`. HIDDEN items: none in the layout itself.
- **Reached from:** every `/lms/*` URL; learner post-login landing.
- **Purpose:** wraps learner pages in sidebar + header and hosts the every-N-units tutor-feedback prompt.
- **UI & actions:** `Sidebar.Provider` + `LMSSidebar` + `LmsHeader` + `max-w-6xl` content. **Tutor-feedback dialog** (`features/lms/components/tutor-feedback-dialog.svelte`): shown on mount when `GET /lms/tutor-feedback` returns `dueMilestone` and a `tutor`. Title "How is {tutorName} doing?", description says the feedback is private (only "the Pearl admin team", never the tutor) and optional. Fields: Overall star rating (required, 1-5), Communication & support, Helpfulness of feedback, Subject knowledge (optional 1-5 stars), Comments (optional textarea, max 2000). Buttons "Not now" (closes) and "Submit feedback" (disabled until overall > 0). On error shows "Sorry, that didn't save." Throttle: at most 3 shows per milestone, once per login (localStorage `pearl.tutorFeedback.shows.v1`, sessionStorage `pearl.tutorFeedback.shownMilestone`). Milestone cadence: first at 2 passed units, then every 5 (2, 7, 12, 17...) (`packages/utils/src/validation/tutor-feedback/tutor-feedback.ts`, `FIRST_MILESTONE=2`, `MILESTONE_INTERVAL=5`); server recomputes milestone from real passed-unit count; nothing prompts when the learner has no resolvable tutor. 409 on duplicate (onConflictDoNothing on learner+milestone).
  Other global popups mounted above this layout: **Pending org invite modal** (root layout; `features/lms/components/pending-invite-modal.svelte`, accept via `POST /invite/organization/:inviteId/accept-by-id`), **Verify-email modal** (`features/onboarding/components/verify-email-modal.svelte`, opens when profile email unverified; admin-provisioned accounts are pre-verified so learners never see it), **Impersonation banner** (amber top bar "You are viewing as X / Return to admin" when an admin is impersonating), Upgrade modal (cloud billing, dormant), Command palette (Ctrl+K style search).
- **API calls:** `GET /lms/tutor-feedback`, `POST /lms/tutor-feedback` (body `{overallRating, communicationRating?, helpfulnessRating?, knowledgeRating?, comment?}`) - `apps/api/src/routes/lms/lms.ts`, `apps/api/src/services/lms/tutor-feedback.ts`, `packages/db/src/queries/tutor-feedback/`; `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` (`apps/api/src/routes/comms/notifications.ts`); `POST /account/heartbeat`; `GET /account` (app init).
- **Data:** `tutor_feedback`, `tutor_allocation` (tutor resolution), `lesson_completion`/`coursework_result` (passed-unit count), `profile`, `notification`, `session` (heartbeat touches `updated_at`), `audit_event`.
- **Wired?:** working (PearlLMS-specific).
- **Brand strings:** "Pearl admin team" in dialog copy; localStorage keys `pearl.*`.

#### Learner Dashboard (Home) - `/lms`
- **Roles:** any authenticated member; designed for LEARNER (all data self-scoped server-side). Not flag-controlled.
- **Reached from:** post-login redirect (`homeForRole`), sidebar "Home", logo, `/` redirect.
- **Purpose:** the learner home: welcome, KPIs, progress, tutor card, draft feedback, news, due dates, messages, course progression, study hours.
- **UI & actions** (`features/lms/pages/dashboard.svelte`, page `<title>` "Student Dashboard"): broadcast banner(s) at top (`features/announcements/components/broadcast-banner.svelte`: up to 3 newest non-archived announcements, dismissible, dismissal stored per device in localStorage `pearl.dismissedBroadcasts`); dark welcome banner "Welcome back, {firstName}" + "Here's your learning overview" + quick buttons My Courses (`/lms/mylearning`), Inbox (`/messages`), Assessments (`/lms/exercises`); Upcoming live sessions card (only if an enrolled LIVE_CLASS course has `upcomingSession`; shows call link); five KPI tiles - Enrolled Courses (links mylearning), Due Assignments (links exercises), Completed, Overall Progress %, Unread Messages (links messages); progress ring with Courses / Units passed / Units remaining / Day streak / Awaiting marking / Next due (relative days); **My Tutor** card (name, email, "Contact Tutor" -> `/messages`; empty "No tutor assigned yet."); **Draft Feedbacks** list (items whose latest submission is a draft with tutor feedback; each links to the lesson; empty "No draft feedback yet"); **News & Updates** (announcement list, hidden when none); **Upcoming Due Dates** (name, unit, course, Overdue/Today/Tomorrow/in N days badge; empty "All caught up - nothing due."); **Recent Messages** (thread preview, unread dot, "View All" -> `/messages`; empty "No messages yet."); **Course Progression** (per course "X of Y passed", progress bar, links to `/courses/{id}/lessons?next=true`; empty "You're not enrolled in any courses yet."); **Study Hours** bar chart (12 months, total). No forms.
- **API calls:** `GET /lms/dashboard` (`apps/api/src/routes/lms/lms.ts`, `apps/api/src/services/lms/dashboard.ts`; aggregates `getEnrolmentsForLearners`, `computeLearnerCourseProgress`, `listTutorsForLearner`, `getLearnerMessageSummary`, `getUserLoginStreak`, `getMonthlyStudyForLearner`, `getLearnerAssignments`); `GET /announcements` (`routes/comms/announcements.ts`); `GET /organization/courses/enrolled` (`routes/organization/organization.ts:427`, progress overlaid with result-derived passed/total via `services/progress/enrolled-progress`).
- **Data:** `groupmember` (enrolment), `course`, `lesson`, `course_section`, `coursework_submission`, `coursework_result`, `tutor_allocation`, `profile`, `message_thread`, `message`, `message_read`, `announcement`, `unit_time_spent`/`unit_time_monthly` (study hours), `analytics_login_events` (streak), `lesson_completion`, `course_completion`.
- **Wired?:** working. Note leftover unused component `features/lms/components/learning.svelte` ("Currently Learning" card, upstream) is not mounted here.
- **Brand strings:** `<title>Student Dashboard`; sidebar org name/logo from DB; "Student" translation for `dashboard.learner`.

#### My Learning - `/lms/mylearning`
- **Roles:** any authenticated member (self data); learner-oriented. Not hidden.
- **Reached from:** sidebar "My Learning", dashboard quick button / KPI / "View All".
- **Purpose:** list of the learner's enrolled courses split In progress vs Complete.
- **UI & actions** (`routes/(app)/lms/mylearning/+page.svelte`, `features/lms/pages/mylearning.svelte`): title "My Learning"; two underline tabs "In progress (n)" and "Complete (n)" (completion by `isStudentCourseComplete`); each tab = searchable course card grid (`features/course/pages` CoursesPage with `isLMS`); card click goes to the course continue path `/courses/{id}/lessons?next=true`. Empty states: "No Course In progress / Any course that you start will be displayed here", "No Course Completed". "Find courses" button only if `EXPLORE_ENABLED` (so never in prod). Search is client-side.
- **API calls:** `GET /organization/courses/enrolled` (`apps/api/src/routes/organization/organization.ts:427`).
- **Data:** `groupmember`, `course`, `lesson`, `course_completion`, `coursework_result`.
- **Wired?:** working.
- **Brand strings:** `<title>My Learning - Integer Training LMS`.

#### Assessments (coursework board) - `/lms/exercises`
- **Roles:** any authenticated member (self data); learner-oriented. Nav item shown to everyone on self-hosted.
- **Reached from:** sidebar item labelled "Exercise" (en.json `lms_navigation.exercise`) while the page header says "Assessments" - label mismatch; dashboard "Assessments" button and Due Assignments KPI.
- **Purpose:** kanban of every workbook / case study / assignment across enrolled courses, by state. Replaces upstream quiz "exercises" (PearlLMS has no quizzes).
- **UI & actions** (`features/lms/pages/exercises.svelte`; heading "Assessments", subtitle "Your workbooks and case studies across all your courses."): 5 columns: To do (not started, locked items sorted last), In progress (draft / draft_feedback), Awaiting marking, Needs resubmission (referred), Passed. Each card: course, assessment name, kind badge (Workbook / Case study / Assignment via `MATERIAL_KIND_LABELS`), unit title, due date (red when overdue, amber within 3 days), lock line "Locked - pass '{unit}' first", verdict + tutor feedback excerpt, "Submitted (vN) - awaiting your tutor", "Feedback ready - submit your final", "Draft submitted - awaiting feedback", link "Start ->" / "Open ->" to `/courses/{courseId}/lessons/{lessonId}`. Empty: "No assessments yet - Workbooks and case studies from your courses will appear here as they become available." No submit action here.
- **API calls:** `GET /lms/assignments` (`routes/lms/lms.ts`, `services/lms/assignments.ts`; uses `getCourseUnlockMap` from `services/gating/unlock`).
- **Data:** `coursework_submission`, `coursework_result`, `lesson` (documents jsonb holds assessment items with `kind`, `key`, due date, `allowDrafts`), `groupmember`, `course`.
- **Wired?:** working. Server-side unlock map is authoritative.
- **Brand strings:** `<title>Assessments` (no brand); nav label "Exercise" is upstream wording.

#### Certificates - `/lms/certificates`
- **Roles:** learner (self). **HIDDEN** - `CERTIFICATES_ENABLED=false`; `+page.ts` redirects 303 to `/lms`.
- **Reached from:** nothing (nav item removed).
- **Purpose:** upstream list of earned course certificates (cards from enrolled courses where `certificateEarnedAt` is set, with search).
- **UI & actions:** `features/lms/pages/certificates.svelte` - search box, card grid, empty "no certificates" state. Does not render the certificate itself; per-course certificate pages (`/courses/[id]/certificates`) are admin-only. PearlLMS issues certificates off-platform/manually.
- **API calls:** `GET /organization/courses/enrolled` (via `coursesApi.getEnrolledCourses`).
- **Data:** `course_certificate_issue`, `course_completion_record` / `course_completion`.
- **Wired?:** upstream leftover (hidden, no learner-facing certificate download in this fork).
- **Brand strings:** `<title>Certificates - Integer Training LMS`.

#### Cohorts - `/lms/cohorts`
- **Roles:** learner (self). **HIDDEN** - `COHORTS_ENABLED=false`; redirect to `/lms`.
- **Reached from:** nothing.
- **Purpose:** upstream list of cohorts the learner is enrolled in (search + `CohortsPage`).
- **UI & actions:** `routes/(app)/lms/cohorts/+page.svelte` - title "Cohorts", search, cohort cards, empty "No cohorts yet".
- **API calls:** `GET /cohort/enrolled` (`features/cohort/api/cohort.svelte.ts` `listEnrolledCohorts`; `apps/api/src/routes/cohort/`).
- **Data:** `cohort`, `cohort_member`, `cohort_course`.
- **Wired?:** upstream leftover (hidden).
- **Brand strings:** `<title>... - Integer Training LMS`.

#### Community (list) - `/lms/community`
- **Roles:** learner. **HIDDEN** - `COMMUNITY_ENABLED=false` (layout `community/+layout.ts` redirects all three community routes to `/lms`) and requires org customization `dashboard.community===true` for the nav item.
- **Reached from:** nothing in prod.
- **Purpose:** upstream Q&A forum listing with "Ask the community" button.
- **UI & actions:** `features/community/pages/community.svelte` + `AskCommunityButton`.
- **API calls:** `/community/*` (`apps/api/src/routes/community/community.ts`).
- **Data:** `community_question`, `community_answer`.
- **Wired?:** upstream leftover (dead in prod).
- **Brand strings:** `<title>Community - Integer Training LMS`.

#### Ask the community - `/lms/community/ask`
- **Roles:** learner. **HIDDEN** (same layout redirect).
- **Reached from:** Community page button.
- **Purpose:** form to post a new question.
- **UI & actions:** back button, `AskCommunityPage` (title/body editor, course picker).
- **API calls:** `POST /community/question` (`features/community/api/*`).
- **Data:** `community_question`.
- **Wired?:** upstream leftover.
- **Brand strings:** `<title>Ask the Community - Integer Training LMS`.

#### Community question - `/lms/community/[slug]`
- **Roles:** learner. **HIDDEN** (same layout redirect).
- **Reached from:** Community list.
- **Purpose:** question thread with answers and voting.
- **UI & actions:** `CommunityQuestionPage` with `slug`, back link.
- **API calls:** `GET /community/question/:slug`, answer/vote endpoints.
- **Data:** `community_question`, `community_answer`.
- **Wired?:** upstream leftover.
- **Brand strings:** `<title>Question - Integer Training LMS`.

#### Explore - `/lms/explore`
- **Roles:** learner. **HIDDEN** - `EXPLORE_ENABLED=false`; redirect to `/lms`.
- **Reached from:** nothing (also hides the "Find courses" empty-state button).
- **Purpose:** upstream catalogue of published courses the learner is not enrolled in (self-enrol). Meaningless in a staff-provisioned system.
- **UI & actions:** `features/lms/pages/explore.svelte` - paged course grid, search, filters.
- **API calls:** `GET /organization/courses/recommended` (`routes/organization/organization.ts:455`).
- **Data:** `course`, `groupmember`.
- **Wired?:** upstream leftover (hidden).
- **Brand strings:** `<title>Explore - Integer Training LMS`.

#### Settings (root) - `/lms/settings`
- **Roles:** learner. Redirect only: `+page.ts` throws 303 to `/lms/settings/notifications`. Reason in code: learners may NOT edit profile (name/email); the old profile page (`features/settings/pages/profile.svelte`) is unreachable.
- **Reached from:** direct URL only; `routes/(app)/lms/settings/+layout.svelte` just wraps pages (`md:max-w-3xl`).
- **Purpose:** n/a (redirect). **UI & actions:** none (dead `+page.svelte` kept). **API calls:** none. **Data:** none.
- **Wired?:** dead/redirect. **Brand strings:** `<title>Settings - Integer Training LMS` in the dead page.

#### Notification preferences - `/lms/settings/notifications`
- **Roles:** any authenticated member (learner sees a reduced set). Not hidden; the only learner setting.
- **Reached from:** sidebar "Settings".
- **Purpose:** choose which emails to receive.
- **UI & actions** (`features/settings/pages/notifications.svelte` + `features/notifications/components/comms-preferences.svelte`): header "Notifications" + subtitle; Save bar with Discard / Save changes (appears when dirty). **Personal email toggles** (switches, default ON): Grading result ("submissionGraded"), Newsfeed, Quiz assigned, Session reminders, Course completion, Cohort reminder; tutor-only toggles `newStudent` and `newSubmission` are filtered out for learners (`$isOrgStudent`). Org-level section appears only for admins (`$isOrgAdmin`). **"Communication emails"** section (auto-saves per toggle, separate from the save bar): one switch per notification category from the Phase-6 framework (coursework, message, announcement, session, registration for staff) with "Using the default for this notification" hint; note "In-app notifications always arrive - these switches only control email."
- **API calls:** `GET/PUT /organization/member/email-notifications` (`apps/api/src/routes/organization/`; shape from `packages/utils/src/notifications/`), `GET /notifications/preferences`, `PUT /notifications/preferences/:category` (`routes/comms/notifications.ts`), org settings update for admins.
- **Data:** `organizationmember_email_notifications`, `notification_preference`, `organization.settings.emailNotifications`.
- **Wired?:** working. Some toggles (Quiz, Cohort, Newsfeed) map to upstream features that are unused in PearlLMS - cosmetic noise.
- **Brand strings:** `<title>... - Integer Training LMS`; per-org copy via `{orgName}`.

#### Integrations (learner) - `/lms/settings/integrations`
- **Roles:** learner. **HIDDEN/removed** - `+page.ts` redirects 303 to Notifications. 
- **Reached from:** nothing. **Purpose:** upstream Google-Drive / calendar integrations page. **UI & actions:** none reachable. **API/Data:** none.
- **Wired?:** upstream leftover (dead). **Brand strings:** `<title>Integrations - Integer Training LMS`.

---

## B. Learner-facing pages that live outside `/lms` but are part of the learner path

#### Forced password change - `/change-password`
- **Roles:** any authenticated member (required for admin-provisioned accounts flagged `profile.settings.mustChangePassword`).
- **Reached from:** automatic redirect in `features/app/init.svelte.ts` `routeUserToNextPage` (runs after session setup whenever the flag is set); no nav link.
- **Purpose:** learner replaces the admin-issued temporary password on first login (or after an admin reset).
- **UI & actions** (`routes/(app)/change-password/+page.svelte`): card "Set a new password"; copy "Your account was set up with a temporary password. Please choose your own to continue."; fields Current (temporary) password, New password (min 8), Confirm new password (must match); button "Update password" (disabled until valid); inline errors. On success clears the flag locally and goes to `homeForRole`.
- **API calls:** `POST /account/change-password` (`apps/api/src/routes/account/account.ts:91`, zod `{currentPassword, newPassword min8 max128}`, calls Better Auth changePassword with `revokeOtherSessions:false`, then `updateProfile settings.mustChangePassword=false`).
- **Data:** `account` (credential hash), `profile.settings`.
- **Wired?:** working.
- **Brand strings:** `<title>Change your password` (no brand).

#### Retired landings - `/home`, `/welcome`, `/` 
- `routes/(app)/home/+page.server.ts` and `routes/(app)/welcome/+page.server.ts`: authed users 303 to `homeForRole`. `routes/+page.server.ts`: `/` sends authed users to role home and anon to `/login` (the original marketing landing `routes/+page.svelte` and org landing-page themes are dead in prod). `welcome/+page.svelte` still carries "Welcome - Pearl LMS" but is unreachable.
- **Wired?:** redirect only.

#### Learner course list / unit view (summary only; other agent documents course routes)
- `/courses/[id]/lessons` (`routes/(app)/courses/[id]/lessons/+page.svelte`) and `/courses/[id]/lessons/[lessonId]` (`.../[lessonId]/+page.svelte` -> `features/course/pages/lesson.svelte`). Guard: `(app)/courses/[id]/+layout.server.ts` only `requireActor` (enrolled learners allowed; every admin sub-page adds its own `requireAdmin`); layout shows a "not permitted" dialog to non-members; the API enforces content-read and unlock.
- **Learner sees (lesson list):** sections/units with lock state; `?next=true` auto-advances to the next unlocked unit. Locked units show `StudentContentLockedNotice` with a hint such as "pass '{previous unit}' first" (server unlock map `courseUnlockApi`, `GET` unlock map from `services/gating/unlock`).
- **Learner sees (unit page):** title, optional LiveSessionCard (call link + time), lesson body/video/slides/documents (view-only), an amber banner "This unit has N assessments to submit" with "Go to assessment" scroll, an `IdVerificationStatus` panel on `id-check` units (own status only), and an **Assessments** section with one card per tagged document (`documents[].kind` in workbook/casestudy/assignment) from `features/course/components/lesson/coursework-submission.svelte`: "Download brief" (presigned), Final (graded) vs Draft (feedback only) toggle when `allowDrafts`, drag-and-drop upload (PDF/.doc/.docx, up to 5 files, size from server upload limits), optional comment (max 5000), "Submit final"/"Submit draft"; after submit shows each version (Version n, Draft/Final badge, Pass/Refer/"Awaiting marking"/"Draft feedback" badge, files, own comment, tutor feedback text and downloadable feedback files); passed items lock further uploads; referred items prompt resubmission. "Message your tutor ->" links to `/messages`. A hidden heartbeat (`features/course/utils/unit-time-heartbeat.ts`) records active study time.
- **"Draft save":** there is NO autosave of in-progress text. A "draft" is a first-class submission of type `draft` uploaded as a file for tutor feedback only; it does not count toward Pass.
- **Submission flow / API:** `POST /course/:courseId/lesson/:lessonId/coursework/presign` (server computes version + learner-scoped key) -> browser `PUT` straight to the presigned URL (axios) -> `POST /course/:courseId/lesson/:lessonId/coursework` registers the keys; `GET .../coursework` lists own submissions; `POST .../coursework/download` presigns downloads (`apps/api/src/routes/course/coursework.ts`, `requireCourseworkSubmit`/`requireActor`). Tables `coursework_submission`, `coursework_result`, `lesson` (documents jsonb), `unit_time_spent`, `notification` (a `submission.created` notice goes to the allocated tutor, `result.recorded` back to the learner). Upload size/stall fixes are in memory notes (DASHBOARD_BODY_SIZE_LIMIT; PUT timeout/retry).
- **Wired?:** working (core PearlLMS value).

---

## C. Auth routes `(auth)/**` (all PUBLIC unless noted; hooks.server.ts allows `/login`, `/logout`, `/signup`, `/forgot`, `/reset`, `/verify-email-error`, `/auth-failed`, `/invite/*`, `/404`, `/csp-report`)

#### Login - `/login`
- **Roles:** anonymous (public route). 
- **Reached from:** `/` redirect, hooks redirect for unauthenticated hits (`/login?redirect=<path>`), logout, invite pages, enroll page, forced redirect on stale session.
- **Purpose:** email + password sign-in for staff-provisioned users.
- **UI & actions** (`routes/(auth)/login/+page.svelte` inside `AuthUI`, `features/ui/auth-ui.svelte`): card with org avatar/logo, "Welcome back" + "Sign in to continue"; Email (`type=email`, autofocus, prefilled + read-only when `?email=` present, e.g. from invite links); Password (show/hide) with "Forgot password?" link to `/forgot`; "Log In" button. Client validation (`authValidation`): valid email, password >= 6 chars (server minimum is 8). Errors shown under fields and as `submitError`. SSO: on email blur the page calls SSO discovery; if an org SSO config applies it shows "Sign in with {provider}" (self-hosted: dormant, tables empty and the `sso()` plugin is removed from the auth config when `PUBLIC_IS_SELFHOSTED`). Optional per-org flags `disableEmailPassword` / `disableGoogleAuth` and auth background image (`org.customization.auth.backgroundImage`; otherwise a DotPattern). On success: `window.location.href = redirect || '/'` -> `/` -> `routeUserToNextPage` -> `/change-password` if flagged, else role home. The AGPL "Source code" link under the card is commented out (hidden since 2026-09-07). No Sign-up link, no Google button.
- **API calls:** `POST /api/auth/sign-in/email` (Better Auth, via dashboard proxy, `packages/db/src/auth.ts`); `GET /api/auth/get-session`; SSO discovery `ssoApi.discoverSso` / `getOrgSsoInfo`.
- **Data:** `user`, `account`, `session`, `profile` (status), `system_event_log` (login success/failure incl. `bad_credentials`, `deactivated`, `rate_limited`), `analytics_login_events` (via `trackLoginHook`).
- **Wired?:** working. Rate limit 10 sign-ins / 15 min per IP (`LOGIN_RATE_LIMIT`). Deactivated profiles are blocked at `session.create.before` with "Your account has been deactivated. Contact an administrator."
- **Brand strings:** `<title>Welcome back to {org name | 'Integer Training LMS'}`; avatar fallback `/logo-192.png`; PostHog/umami helper calls are no-ops.

#### Logout - `/logout`
- **Roles:** public route (so a dead session can leave). **Reached from:** sidebar Log out button and account dropdown. **Purpose:** sign out and bounce to login.
- **UI & actions:** "Logging you out..." then `logout()` (`lib/utils/functions/logout.ts`): `authClient.signOut()`, `appInitApi.reset()`, clears Sentry/UserJot, `goto('/login')`.
- **API calls:** `POST /api/auth/sign-out` (also logged in `system_event_log` before the session is deleted). **Data:** `session`.
- **Wired?:** working. **Brand strings:** none.

#### Forgot password - `/forgot`
- **Roles:** anonymous. **Reached from:** Login "Forgot password?" link.
- **Purpose:** request a reset email.
- **UI & actions** (`routes/(auth)/forgot/+page.svelte`): "Forgot Password / We will send you a reset link to your email"; field "Your email" (zod `ForgotPasswordSchema`, valid email); buttons "Reset Password" and "Cancel". Success state: icon + "Email Sent! We have sent a confirmation email to {email}. Kindly check your inbox ... or spam" + "Okay" -> `/login`. The success state is shown even for unknown emails (no enumeration).
- **API calls:** `POST /api/auth/request-password-reset` with `redirectTo = <origin>/reset` (`features/auth/api/forgot.svelte.ts`). Server: `sendResetPassword` -> `sendEmail('forgotPassword')` (`packages/db/src/auth/email-password.ts`, `packages/email/src/emails/forgot-password.ts`). Rate limit 5 / hour / IP (`PASSWORD_RESET_RATE_LIMIT`). Token valid 1 hour.
- **Data:** `verification` (reset token), `user`, `profile`.
- **Wired?:** working iff SMTP is configured (see Auth mechanism section: email delivery was long "dormant"; confirm prod SMTP).
- **Brand strings:** `<title>Forgot Password - Integer Training LMS`; email subject "Password reset notification - Integer Training LMS", body "your Integer Training LMS account", mailto `help@classroomio.com`.

#### Reset password - `/reset`
- **Roles:** anonymous with a `?token=`. **Reached from:** link in the reset email.
- **Purpose:** set a new password.
- **UI & actions** (`routes/(auth)/reset/+page.svelte`): card "New Password / Enter your new password details"; fields Your Password (min 8 via `ResetPasswordSchema`, hint "Password must be more than 8 characters") and Confirm Password (live mismatch error); "Reset Password" button. No token: snackbar "Invalid Token" and redirect to `/login` after 2s. Success: snackbar + `goto('/login')`.
- **API calls:** `POST /api/auth/reset-password {newPassword, token}`; then `onPasswordReset` sends `onPasswordReset` confirmation email (`packages/email/src/emails/on-password-reset.ts`).
- **Data:** `verification`, `account`.
- **Wired?:** working (email-dependent). 
- **Brand strings:** `<title>Reset Password - Integer Training LMS`.

#### Sign up - `/signup`
- **Roles:** anonymous. **Reached from:** old links only (all "Sign up" links removed).
- **Purpose:** retired. `+page.server.ts` does `redirect(308, '/register')`. The 295-line `+page.svelte` (upstream signup form) is dead code. Backend also blocks it: `emailAndPassword.disableSignUp: true` (`packages/db/src/auth/email-password.ts`) -> `POST /api/auth/sign-up/email` returns `EMAIL_AND_PASSWORD_SIGN_UP_IS_NOT_ENABLED`.
- **UI/API/Data:** none live. **Wired?:** dead/redirect. **Brand strings:** dead page strings.

#### Register interest (public application) - `/register`
- **Roles:** intended anonymous. **Reached from:** `/signup` redirect.
- **Purpose:** the sole public entrance in the Phase-7 governed-intake model: creates a PENDING `registration` row, never an account. Staff approve in `/registrations`.
- **UI & actions** (`routes/(auth)/register/+page.svelte`, SvelteKit form action in `+page.server.ts`): heading "Register your interest" + explanatory copy; Full name (required), Email (required), "Course of interest" select (optional; options = published courses from the API), hidden honeypot field (`REGISTRATION_HONEYPOT_FIELD`, filled = silently dropped), "Submit registration"; "Already have an account? Sign in". Error messages are neutral: 400 "Please enter your name and email.", 409 "If you already have an account or a pending application, please sign in or contact us.", 429 "Too many attempts. Please try again in a minute.". Success: 303 to `/register/thanks`. Forwards visitor IP as `x-forwarded-for` for the per-IP rate limit.
- **API calls:** `GET /register/courses` and `POST /register` (both `apiKeyMiddleware`, server-to-server; `apps/api/src/routes/registration/registration.ts`, `apps/api/src/services/registration/registration.ts`, `rate-limit.ts`). Fires staff notification `registration.submitted` + email template `registrationSubmitted` to all Managers and Admins.
- **Data:** `registration`, `notification`, `organization` (managers/admins lookup).
- **Wired?:** **SUSPECT - likely unreachable by anonymous visitors.** `/register` and `/register/thanks` are NOT in `PUBLIC_ROUTES` (`lib/utils/constants/routes.ts`), so `hooks.server.ts` will 303 an anonymous visitor to `/login?redirect=%2Fregister`. The code comment claims "(auth) group has no app-layout guard" but the hook gate is separate. Verify live before replicating; to make it work add `^/register(/thanks)?$` to `PUBLIC_ROUTES`. Backend and approval queue are fully built.
- **Brand strings:** `<title>Register your interest` (no brand).

#### Register thanks - `/register/thanks`
- **Roles:** intended anonymous (same hook caveat as above). **Reached from:** successful registration.
- **Purpose:** stateless confirmation.
- **UI & actions:** "Thanks - we've got your details"; text says an approved applicant "will get an email with a link to set your password" (this is inaccurate relative to the code, see Auth mechanism: approval creates the account with a temp password and sends no set-password link); link "Back to sign in".
- **API/Data:** none. **Wired?:** working page; copy is drifted. **Brand strings:** `<title>Thanks - registration received`.

#### Org onboarding - `/onboarding`
- **Roles:** authenticated user (the `(auth)` group has no layout guard; the page needs `$profile.id`). 
- **Reached from:** `routeUserToNextPage` when the logged-in user has zero organizations (cloud/self-hosted first run).
- **Purpose:** upstream "create your academy" wizard; in PearlLMS a closed system.
- **UI & actions:** `+page.server.ts` redirects 303 to `/` when `locals.organizations.length > 0`, so provisioned users never see it. Otherwise 2-step wizard: Full name, Organisation name, site name (suffix `.classroomio.com`), goal radios, source radios, language select; Back/Continue.
- **API calls:** `POST /onboarding/create-org`, `POST /onboarding/update-metadata` (`apps/api/src/routes/onboarding/`); `createOrganizationWithOwner` throws 403 on self-hosted once any org exists ("Self-hosted instances support only one organization").
- **Data:** `organization`, `organizationmember`, `organization_plan`, `profile`.
- **Wired?:** upstream leftover; reachable only on a brand-new empty instance (first-run bootstrap for the first admin). A new brand install needs this exactly once to create the org unless seeded via `db:setup --seed`.
- **Brand strings:** logo `/logo-192.png` alt "Integer Training LMS logo", header "Integer Training LMS", site-name suffix `.classroomio.com`.

#### Verify-email error - `/verify-email-error`
- **Roles:** anonymous. **Reached from:** Better Auth verification-link failures (`?error=token_expired|email_mismatch|legacy_method_blocked|database_error|...`).
- **Purpose:** explain a failed email verification.
- **UI & actions:** full-page `Empty` with title/message by error code, optional yellow "security notice" for `legacy_method_blocked`, buttons "Contact support" (opens `mailto:help@classroomio.com?subject=Email Verification Issue...`) and "Back to dashboard" -> `/`.
- **API/Data:** none. **Wired?:** working but rarely used (learners are pre-verified; emails are the only source). **Brand strings:** `<title>Email Verification Error - Integer Training LMS`; **hardcoded `help@classroomio.com`**.

#### Auth failed - `/auth-failed`
- **Roles:** anonymous. **Reached from:** OAuth/SSO callback failures (`?error=CODE`). 
- **Purpose:** generic "Something went wrong" page. **UI & actions:** logo, text, `CODE: {error}`, "Go Home" -> `/`.
- **API/Data:** none. **Wired?:** upstream leftover (no social/SSO in prod). **Brand strings:** `<title>Reset Password - Integer Training LMS` (copy bug, wrong title); fallback name "Integer Training LMS".

---

## D. Invite pages (public routes; `^/invite/.*`)

#### Organization invite - `/invite/[hash]`
- **Roles:** anonymous or authenticated (accept requires login and matching email).
- **Reached from:** an organization invite email/link (`organization_invite` token).
- **Purpose:** preview and accept a staff or learner invite into the org.
- **UI & actions** (`routes/invite/[hash]/+page.svelte`, `+layout.server.ts`): `AuthUI` card with org branding/theme; message by role ("You've been invited to join {org} as a student / teacher / admin / {role}"), "Invited email: {email}"; status messages for EXPIRED / REVOKED / ACCEPTED / invalid / email mismatch (red text); button "Accept invite" (disabled if not ACTIVE or mismatch) - if not logged in it redirects to `/login?redirect=<path>&email=<invited email>` (closed system: invitees must already have an account); after accept `window.location.href = redirectTo || '/org'`; if already joined shows "Go to LMS" (student) or "Go to dashboard"; link "Already have an account? Log In". Load: SSR calls the API with an API key; any failure -> 404.
- **API calls:** `GET /invite/organization/:token/preview` (apiKeyMiddleware), `POST /invite/organization/:token/accept` (authMiddleware), `GET /invite/organization/pending`, `POST /invite/organization/:inviteId/accept-by-id` (`apps/api/src/routes/invite/invite.ts`, services under `apps/api/src/services/organization/invite.ts`); `getOrgBySiteName`.
- **Data:** `organization_invite`, `organization_invite_audit`, `organizationmember`, `profile`.
- **Wired?:** working in code, but UNUSED by the PearlLMS provisioning path (learners are created via admin "create learner"/registration approval, not via org invites; the `team/invite` UI in `features/org/api/org.svelte.ts:478` exists upstream). Keep for compatibility; note invite email From name is `"{org} (via ClassroomIO.com)"` and subject "... on ClassroomIO" (`apps/api/src/services/organization/invite.ts:271-272`).
- **Brand strings:** page title via i18n `invite.organization.page_title`; copy strings in translations; email branding above.

#### Invite link - `/invite/link/[hash]`
- **Roles:** anonymous/authenticated. **Reached from:** a reusable link-invite. **Purpose:** self-join an org at the link's role (this is the "self-accept" door left open for the Phase-7 approval model - any authenticated user holding the link can join at that role).
- **UI & actions** (`routes/invite/link/[hash]/+page.svelte`): same card; message by role; red "disabled" text if revoked; button "Accept" -> redirect to `/login?redirect=...` when anonymous; link to Log In. 
- **API calls:** `GET /invite/link/:token/preview` (api key), `POST /invite/link/:token/accept` (auth).
- **Data:** `organization_invite` (link variant), `organizationmember`.
- **Wired?:** working code; unused unless an admin creates link invites. **Security note:** treat as a closure gap (ACCESS.md §1.2 documents it).
- **Brand strings:** i18n `invite.link.*`.

#### Not found - `/404`
- **Roles:** public. **Reached from:** explicit redirects; `+error.svelte` handles runtime 404s.
- **Purpose:** friendly 404. **UI & actions:** `Empty` "Page not found" (or "Organization doesn't exist!" when `?type=org`) + "Back to Safety" button -> `/` (or **https://classroomio.com** for org case). `routes/+error.svelte` also links to classroomio.com and classroomio.com/tools.
- **API/Data:** none. **Wired?:** working. **Brand strings:** hardcoded classroomio.com URLs (3).

---

## E. Public org site `(org-site)` - **active in prod because self-hosted mode makes every request an org-site request**

Group guard (`routes/(org-site)/+layout.server.ts`): 404 if org-site but no org; `+layout.svelte` shows `PageRestricted` if the org is restricted, and initialises first-party analytics (`POST /dash/track`, page views kind landing/course). Public in `PUBLIC_ROUTES`: `^/courses/?$`, `^/course/[^/]+(/enroll)?/?$`, `^/course/[^/]+/lesson/.*`, `^/pages/.*`.
**Exposure warning for a closed-system brand:** `/courses` lists, to anonymous users, every course in the org with `status='ACTIVE'` AND `is_published=true` (any type, with price/pagination/tag filters) via `getPublishedCoursesBySiteName` (`packages/db/src/queries/course/course.ts:60`). `/course/[slug]` renders a public landing for any course slug the API returns. Course item bodies at `/course/[slug]/lesson/*` are served anonymously only for courses of `type = 'PUBLIC'` and published (`packages/db/src/queries/course/public-course.ts:124`). In PearlLMS courses are presumably not type PUBLIC, but they ARE listed on `/courses` if published. If the new brand must not advertise its catalogue, hide these routes (remove from `PUBLIC_ROUTES` and/or redirect). Also see the self-enrol gap under `/enroll`.

#### Public course catalogue - `/courses`
- **Roles:** anonymous (public). Redirects 307 to `/` when not an org site. 
- **Reached from:** public lesson shell "Explore courses" link; no in-app nav link.
- **Purpose:** public listing of the org's published courses.
- **UI & actions** (`routes/(org-site)/courses/+page.svelte`, 437 lines; theme bundle from `importThemeBundle(org.landingpage.theme)`): org nav (login/"go to LMS" button depending on session), hero, search box, pricing (free/paid) and course-type filter chips, tag groups, paged grid of course cards linking `/course/{slug}`, empty state. URL params `tags`, `types`, `search`, `pricing`, `page`.
- **API calls:** `GET /organization/courses/public?siteName=...` and `GET /organization/tags/public?siteName=...` (`apps/api/src/routes/organization/organization.ts:391`; no auth).
- **Data:** `course`, `group`, `organization`, `lesson`, `exercise`, `tag`, `tag_group`, `tag_assignment`.
- **Wired?:** working (upstream). Landing-page settings UI is hidden (`LANDING_PAGE_ENABLED=false`) so the org uses the default theme.
- **Brand strings:** meta `"{org.name} - All Courses"`; theme components in `features/org/utils/landing-page` and `packages/ui` may carry ClassroomIO defaults.

#### Course landing - `/course/[slug]`
- **Roles:** anonymous (public).
- **Reached from:** `/courses` cards, shared links.
- **Purpose:** public course landing page; PUBLIC-type courses skip it.
- **UI & actions:** `+page.server.ts` first tries the anonymous org-site tree; if the course is `PUBLIC` with items it 302s to `/course/{slug}/lesson/{firstItemSlug}`. Otherwise renders `CourseLandingPage` (themed hero with title, description, price/discount, instructor, curriculum, "Enroll"/"Get started" button -> `/course/{slug}/enroll`), plus a floating `PoweredBy` chip (only if the org is on the free plan; self-hosted orgs get the ENTERPRISE plan so it is hidden). JSON-LD `Course` schema, OpenGraph/Twitter tags (handle `@classroomio`).
- **API calls:** `GET /org-site/course/:courseSlug` (api key), `GET /course/slug/:slug` (api key), `GET /organization?siteName=` (`apps/api/src/routes/org-site/public-course.ts`, `routes/course/course.ts:121`).
- **Data:** `course`, `course_section`, `lesson`, `organization`, `profile`.
- **Wired?:** working (upstream).
- **Brand strings:** `orgName` fallback "Integer Training LMS"; twitter `@classroomio`; PoweredBy link `https://classroomio.com?utm_source=...` and "Powered by Integer Training LMS" (free plan only).

#### Enroll - `/course/[slug]/enroll`
- **Roles:** anonymous to view; logging in required to enrol.
- **Reached from:** landing page Enroll button; student course-invite emails (`?invite_token=`).
- **Purpose:** upstream "join this course" screen.
- **UI & actions** (`routes/(org-site)/course/[slug]/enroll/+page.svelte`, `AuthUI` card): course title/description, invite status messages ("This invite link has expired / has reached its usage limit / has been revoked / is not valid"), "You need to pay for this course or be invited to get access." for paid courses, student-limit message; button "Enroll"/"Join". If anonymous it redirects to `/login?redirect=<enroll url>[&email=<invited email>]` (no signup path). If logged in it calls enrol, then sends a verification email if the profile is unverified, then goes to `/courses/{id}/lessons?next=true`. 
- **API calls:** `GET /invite/student/:token` (preview), `GET /course/slug/:slug`, `POST /course/:courseId/enroll` body `{inviteToken?}` (authMiddleware, `enrollRateLimit`; `services/course/invite.ts:615 enrollInCourse`).
- **Data:** `course_invite`, `course_invite_audit`, `groupmember`, `organizationmember`, `course`, compliance enrolment records.
- **Wired?:** working. **Closure gap:** without an invite token, ANY authenticated user (even without org membership) can self-enrol into any ACTIVE, published, free (cost = 0) course unless `metadata.allowNewStudent === false`; `enrollInCourse` auto-creates an `organizationmember` STUDENT row. In a staff-provisioned system consider setting `allowNewStudent=false` on all courses or patching this.
- **Brand strings:** i18n `course.navItem.landing_page.enroll_page.*`; snackbar texts; welcome email uses org branding.

#### Public lesson shell - `/course/[slug]/lesson` (layout)
- **Roles:** anonymous (PUBLIC-type courses only). `+layout.server.ts` loads the public tree; 404 "Public course not found" otherwise.
- **UI & actions:** `PublicCourseShell` (`packages/ui/src/custom/public-course`): left sidebar of sections/items, header "Explore courses" -> `/courses`, "Sign in" -> `/login`, previous/next footer nav, "Powered by {brand}" footer.
- **API calls:** `GET /org-site/course/:courseSlug`. **Data:** `course`, `course_section`, `lesson`.
- **Wired?:** working. **Brand strings:** i18n `public_course.powered_by.brand` = "Integer Training LMS"; label "Powered by".

#### Public lesson - `/course/[slug]/lesson/[itemSlug]`
- **Roles:** anonymous (PUBLIC courses only).
- **Reached from:** the shell sidebar and the landing redirect.
- **Purpose:** read a lesson/exercise anonymously (video HLS via cookie).
- **UI & actions:** lesson HTML, video (HLS player, mints `cio_hls` cookie), docs; SEO meta + OpenGraph.
- **API calls:** `GET /org-site/course/:courseSlug/item/:itemSlug`, `POST /org-site/course/:courseSlug/item/:itemSlug/hls-cookie`, `GET /hls/:assetId/*` (`apps/api/src/routes/org-site/public-course.ts`).
- **Data:** `lesson`, `lesson_language`, `assets`, `asset_usages`, `media_job`.
- **Wired?:** working (upstream), irrelevant if no PUBLIC courses are authored.
- **Brand strings:** twitter `@classroomio`.

#### Other public/system endpoints (no UI): `/csp-report` (CSP violation sink, public), OG image routes `GET /org-site/og`.

---

## F. Auth mechanism (how it works)

- **Library:** Better Auth (`better-auth/minimal`) with Drizzle adapter (`packages/db/src/auth.ts`). Mounted in the API at `POST|GET /api/auth/*` (`apps/api/src/app.ts:169`); the dashboard SvelteKit server proxies `/api/auth/*` and `/proxy/*` to the API (`hooks.server.ts` -> `proxy-api-request.ts`), so cookies are first-party. Browser client: `features` `lib/utils/services/auth/client.ts` (`better-auth/svelte`, baseURL `<origin>/api/auth`). Cookie prefix `classroomio`, `Secure` in production, host-only, no cross-subdomain.
- **Sessions:** DB-backed `session` table; 7-day rolling window, refreshed at most once per day; 1-hour cookie cache. `customSession` attaches `orgRoles {orgId: roleId}` and `status` to the session; `resolveActor` (`packages/db/src/actor.ts`) re-reads role/status fresh on the API so role changes and deactivation take effect immediately (deactivation also deletes live sessions).
- **Credentials:** email + password only. bcrypt cost 10, min length 8, max 128 (`packages/db/src/auth/email-password.ts`). Login throttled 10/15 min/IP, password-reset 5/hour/IP. Google OAuth removed; `anonymous()` plugin removed; `sso()` and `tokenExchange()` plugins are dropped when `PUBLIC_IS_SELFHOSTED=true`; `oAuthProxy` skipped when self-hosted. Remaining custom plugin `loginLink()` (`GET /api/auth/login-link?token=...`, JWT HS256 signed with `BETTER_AUTH_SECRET`) is used by admin impersonation / "view as student" / "return to admin" (`apps/api/src/routes/account/account.ts`).
- **Self-signup vs invite-only:** **invite-only / staff-provisioned.** Governing switches: (1) `emailAndPassword.disableSignUp: true`; (2) `PUBLIC_IS_SELFHOSTED` must be `'true'` in BOTH the API env and the dashboard build (split-env gotcha); (3) one-org rule in `createOrganizationWithOwner` (403 after the first org); (4) `POST /organization/auto-join` refuses net-new members on self-hosted; (5) the only account-creation primitive is `createOrgUser` (`apps/api/src/services/organization/users.ts`) used by admin create-learner / create-tutor / create-admin (`apps/api/src/services/organization/management.ts`), `POST /organization/users/onboard` and registration approval (`services/registration/decisions.ts` -> `onboardLearner`). Public entrance is the `/register` application (pending row only).
- **What "invite" really is today (differs from the docs):** `docs/ONBOARDING-MODEL.md` §2 and comments in `onboarding.ts` describe a set-password email link. The CODE instead (`createOrgUser`): creates the user with a **random readable 12-char temporary password**, marks the email verified (`markUserAndProfileEmailVerified`), sets `profile.settings.mustChangePassword=true`, and **returns the temporary password once to the calling admin** to hand over (comment: "email delivery is dormant"). No email is sent by `createOrgUser`. The admin-management / learner-management / tutor-management UIs show the revealed password. `resetUserPassword` (admin "Send login"/reset) does the same and kills sessions. **Gap:** `onboardLearner` (used by `POST /organization/users/onboard` and registration approval) DISCARDS `temporaryPassword` from `createOrgUser`'s result, so a learner created that way has no known password and no email; they must use `/forgot` (needs working SMTP) or an admin must run reset-password. Confirm live which path staff use before replicating.
- **Email verification:** `emailVerification.enabled`, link valid 24h, but Better Auth's automatic send is suppressed unless the URL carries `trigger=app` (the dashboard's VerifyEmailModal triggers it). Admin-provisioned users are pre-verified, so learners normally never see the modal. Errors land on `/verify-email-error`.
- **Password reset:** `/forgot` -> `request-password-reset` -> email (`forgotPassword` template) -> `/reset?token=` -> `reset-password` -> confirmation email. Token 1h.
- **Forced change:** `mustChangePassword` -> `/change-password` (see section B).
- **Email transport:** `packages/email` (nodemailer SMTP via `SMTP_HOST/PORT/USER/PASSWORD/SENDER/REPLY_TO`, or ZeptoMail). `.env.deploy.example` documents SMTP as required; `docs/DEPLOY.md` deferred the email-dependent smoke test until SMTP is set. Current prod SMTP state is not determinable from the repo.
- **Audit/logging:** `audit_event` (`user.created`, role change, status change, reset), `system_event_log` (auth.login.success/failure/logout/session_invalid_bounce; client errors from SSR `/log/client`).
- **Learner emails that matter to the journey (templates in `packages/email/src/emails/`):** `forgotPassword`, `onPasswordReset`, `verifyEmail`, `studentCourseWelcome`, `studentOrgInvite`, `studentCourseInvite`, `courseworkResulted`, `messageReceived`, `announcementPublished`, `session`, `studentCourseCompletion`. All inherit the ClassroomIO masthead image/footer from `templates/default.ts`.

---

## G. Other apps in the monorepo

| App | What it is | Deployed in prod? | Needed for the new brand? |
|---|---|---|---|
| `apps/dashboard` (`@cio/dashboard`) | The product UI. | **Yes** - `docker/Dockerfile.dashboard`, service `dashboard` (port 3082) in `docker-compose.deploy.yaml`, behind Caddy. | Yes. |
| `apps/api` (`@cio/api`) | Hono API. | **Yes** (`Dockerfile.api`, `api`, runs `db:setup` on start). | Yes. |
| `apps/jobs` (`@cio/jobs-worker`) | BullMQ workers (emails, notifications, media, maintenance). | **Yes** (`Dockerfile.jobs`, `jobs`). | Yes (email/notification delivery). |
| Redis + Caddy | queue/cache; TLS reverse proxy (`docker/Caddyfile`, `{$APP_DOMAIN}` -> `dashboard:3082`). | **Yes.** | Yes. |
| `apps/course-app` (`@cio/course-app`) | Standalone SvelteKit scaffold for a learner-facing course website (has its own PostHog key, Stripe buy link, Rewardful). Published to npm as `@classroomio/course-app` by a manual workflow (`.github/workflows/publish-course-app.yml`, `workflow_dispatch` only). | **No** (no Dockerfile or compose service). | **No.** |
| `apps/website` (`@cio/website`) | Vendor marketing site (SvelteKit -> Cloudflare; routes marketing/blog/pricing/automation/mcp-recipes/public-courses, GitHub stars fetch, PostHog, umami, cal.com). | **No** ("Not deployed by us"). | **No** - build a separate brand site if wanted. |
| `apps/embeds` (`@cio/embeds`) | Embeddable course-widget bundle served from vendor R2/CDN (`deploy-embeds.yml`, `workflow_dispatch` only, secrets not set). | **No.** Widgets UI hidden (`WIDGETS_ENABLED=false`); dashboard pages `(app)/widgets`, `widget-preview` remain upstream code. | **No.** |
| `apps/tenant-router` (`@cio/tenant-router`) | Cloudflare Worker for the vendor's multi-tenant cloud: subdomain routing, `/proxy` split, R2 HLS, PostHog forwarder. | **No** (the dashboard's own `proxy-api-request.ts` replaces it on a single droplet). | **No.** |
| `apps/docs` (`@cio/docs`) | Vendor docs site (blume/Astro, needs Node 22, wrangler deploy to Cloudflare). | **No.** | **No.** |

Deployment shape (docs/DEPLOY.md): one DigitalOcean droplet (Ubuntu, 2 vCPU/4 GB) running `docker compose -f docker-compose.deploy.yaml up -d --build`; code built from `origin/main` (deployed == pushed, AGPL rule); external Supabase Postgres (pooler 6543 runtime, direct 5432 migrations) and Supabase Storage via the S3 API (private `documents`/`videos`, public `media`); real SMTP; domain A record -> droplet; `.env` holds `BETTER_AUTH_SECRET`, `PRIVATE_SERVER_KEY`, `APP_DOMAIN`, `PUBLIC_APP_URL`, `DATABASE_URL`, `DIRECT_DATABASE_URL`, `OBJECT_STORAGE_*`, `CSP_CONNECT_SRC_DOMAINS`, `CSP_MEDIA_SRC_DOMAINS`, `SMTP_*`. Also set `DASHBOARD_BODY_SIZE_LIMIT` for server-proxied uploads (see memory note). Production URL for the current brand: `https://learn.epearlacademy.com`.

---

## Learner journey end to end (as built)

1. **Account creation (staff side).** An Admin creates the learner (Learner Management "create learner", or `POST /organization/users/onboard`, or approves a `/registrations` application). `createOrgUser` makes the Better Auth user (random temp password), org membership (role 3), pre-verified email, `mustChangePassword=true`, audit `user.created`; the learner is enrolled in the chosen published course (`addCourseMember` + compliance records). **There is no automated invite email**: the admin is shown the temporary password once (create/reset flows) and relays it. If the learner was created through `onboardLearner` (onboard endpoint or registration approval) the password is not revealed, so the learner must use "Forgot password" (needs SMTP) or the admin must reset it. The `/register/thanks` text promising a set-password email is inaccurate. (Legacy invite-email path `/invite/[hash]` exists but is not used by this flow.)
2. **First login.** Learner opens the site -> `/` -> `/login` (hook adds `?redirect=` for deep links). Enters email + temp password (rate limited; deactivated users blocked). Better Auth sets the `classroomio.*` session cookie.
3. **Forced password change.** `appInitApi.setupApp` loads `GET /account`, sees `mustChangePassword`, sends the learner to `/change-password`: enters temp password + new password (>= 8) twice -> `POST /account/change-password` -> flag cleared -> `homeForRole` = `/lms`. (Alternate: `/forgot` -> email -> `/reset?token=`.) No email-verification prompt appears (pre-verified).
4. **Dashboard.** `/lms` loads `GET /lms/dashboard`, announcements and enrolled courses: broadcast banner, KPIs, My Tutor, due dates, course progression. After 2 passed units (then every 5) a tutor-feedback dialog may pop up on login (max 3 times per milestone, optional).
5. **Course.** Click a course in Course Progression or My Learning -> `/courses/{id}/lessons?next=true` -> next unlocked unit -> `/courses/{id}/lessons/{lessonId}`. Locked units show a "pass X first" notice (server-side sequential unlock).
6. **Unit and submission.** The unit page shows material (read-only) and an "Assessments" section. Learner downloads the brief, uploads PDF/Word (<= 5 files) as Draft (feedback only) or Final (graded), optionally with a comment. Flow: presign -> direct PUT to Supabase Storage -> register submission (versioned). Allocated tutor gets an in-app notification (+ email per preference). Learner sees "Awaiting marking".
7. **Feedback.** Tutor records Pass or Refer plus feedback text/files (caseload side). Learner gets `result.recorded` notification (bell, + email if coursework emails are on) and `session.unlocked` when a pass opens the next unit. The unit page shows the badge, tutor feedback and downloadable marked-up files; `/lms/exercises` moves the card to Passed or "Needs resubmission"; draft feedback also appears under Draft Feedbacks on the dashboard. A Refer lets the learner upload a new version.
8. **Messaging.** At any point the learner opens `/messages` (Inbox / Contact Tutor / "Message your tutor") for a thread with the allocated tutor.
9. **Completion and certificate.** When all required units are passed the course counts as complete (My Learning "Complete" tab; `course_completion` recorded; `studentCourseCompletion` email can fire). **There is no learner-facing certificate in this fork**: `/lms/certificates` is hidden/redirects and per-course certificate screens are admin-only; certificates are issued off-platform/manually.

---

## Surprises and replication notes (short list)

1. `/register` and `/register/thanks` are not in `PUBLIC_ROUTES`, so anonymous applicants are bounced to `/login` (the whole Phase-7 public intake is probably unreachable). Verify live.
2. Docs and code disagree on invites: no set-password email is sent; temp passwords are revealed to admins, and `onboardLearner` (registration approval path) drops the password entirely.
3. Any authenticated user can self-enrol into a free published course; `/courses` and `/course/[slug]` expose the published catalogue anonymously because self-hosted mode treats every request as an org site.
4. Many dead-but-present upstream screens (signup, onboarding, community, cohorts, explore, certificates, integrations, profile settings) are flag/redirect-hidden at compile time only; a new brand can delete them.
5. Sidebar label "Exercise" vs page title "Assessments"; "Student Dashboard"/"Student" vs "Learner" wording; `auth-failed` has the wrong `<title>`; learner client-side password min is 6 vs server 8.
6. Brand is split three ways: "Integer Training LMS" (UI), "Pearl LMS" (staff page titles, one dialog line, storage keys), "ClassroomIO" (emails, 404/error links, support mailto, cookie prefix, locale cookie, OG images, meta handles). The three non-prod apps (course-app, website, embeds, tenant-router, docs) can be ignored.


---

# Appendix D — Backend (API, roles, database, jobs, emails)

## PearlLMS backend replication spec (for "Gecko Programmes" on an empty Supabase project)

Source: `C:\Users\PC\Projects\LMSclassroom` at HEAD `0d1eed995` (ClassroomIO hard fork, upstream baseline `9adc38bd8`). Read-only analysis. All paths are repo-relative.
Read first: `docs/CODEMAP.md`, `docs/ACCESS.md`, `docs/BASELINE.md`, `docs/HARDENING-PLAN.md`, `docs/PHASE10.md`, `docs/ENV.md`, `docs/RUNBOOK.md`, `docs/DEPLOY.md`, `docs/TODO-BRANDING.md`.

Headline numbers: **431 route handlers** in 74 router files (+ Better Auth catch-all, health, queue dashboard, HLS/transcript streaming) | **119 tables / 27 pgEnums / 27 migrations** | **9 BullMQ queues (6 with workers, 3 dead)** | **29 email templates** | **523 API tests (67 files)**.

> **Surprises you must plan for (details in the sections):**
> 1. **There is no in-app way to create the first admin or organization on an empty DB.** Public sign-up is hard-disabled (`packages/db/src/auth/email-password.ts` `disableSignUp: true`), `POST /onboarding/create-org` and `POST /organization` need an existing session, and no bootstrap script exists. You must write a one-off bootstrap (section 3.7).
> 2. **RLS is not in the repo.** Schema/migrations contain zero `ENABLE ROW LEVEL SECURITY` / policies, but the live prod project (`cvtmymxxjgjshrzsjxnj`) shows RLS enabled on 119/119 public tables (verified read-only). It was enabled out-of-band (Supabase default/dashboard). The app connects with the DB owner role so RLS never applies to it; PostgREST/anon is simply locked out. Replicate that on the new project (section 3.6).
> 3. **Email branding is still "Integer Training LMS" / classroomio.com** (logo URL on `brand.cdn.clsrio.com`, footer links, welcome mail copy "Best, founder of..."), and reply-to/from fallbacks are classroomio addresses. Needs a rebrand for Gecko (section 5).
> 4. **`/internal/*` cron endpoints have no scheduler in this repo** (nothing calls them); only the three BullMQ repeatable schedulers run by themselves.
> 5. **The `isSelfHosted` flag (`PUBLIC_IS_SELFHOSTED=true`) changes a lot**: one-org limit, v1 public API 404, SSO/token-auth plugins off, ENTERPRISE plan auto-assigned. It must be identical in API and dashboard env (build-time for the dashboard).
> 6. Docs drift: `packages/db/README.md` still says db:setup does `drizzle-kit push` (wrong; it runs committed migrations). `docs/ACCESS.md` says Managers can compose announcements; the route guard (`apps/api/src/routes/comms/announcements.ts`) is `requireAdmin` only.

---

### 1. API route map

#### 1.1 Stack and mount tree (`apps/api/src/app.ts`)

Hono app (Node via `@hono/node-server`, entry `apps/api/src/index.ts`, port `PORT` default 3002). Middleware order (every request):

1. `logger()`, 2. `correlationId()` (`middlewares/correlation-id.ts`; id echoed in generic 500s), 3. `prettyJSON()`, 4. `secureHeaders({crossOriginResourcePolicy:'cross-origin'})`,
5. CORS: paths starting `/public-api/`, `/widgets/`, `/health` use `publicApiCors` (origin `*`, no credentials); everything else `sessionCors` (credentials; origins = `TRUSTED_ORIGINS`, verified custom domains) - `middlewares/cors.ts`,
6. Session hydration: `auth.api.getSession()` sets `c.user`, `c.session`, `c.orgRoles` (cookie-cached map `{orgId: roleId}`), and **`c.actor = resolveActor(userId, header cio-org-id)`** (fresh DB read of role + `profile.status`; deny-by-default; deactivated user => unauthenticated actor). Public CORS paths get `ANONYMOUS_ACTOR` and skip session lookup.
7. `rateLimiter` (`middlewares/rate-limiter.ts`; Redis sliding window, **only active when `NODE_ENV=production`**, fails open after 2s; skipped for trusted `PRIVATE_SERVER_KEY` callers).

Routes then mounted (single root segment each; sub-routers composed inside the domain file):

```
GET  /health  (unauthenticated liveness)        GET /  (welcome JSON)
USE  /api/auth/sign-up/*  -> signupGuard
ON   POST|GET /api/auth/*  -> Better Auth handler (+ OAuth-proxy handoff rewrites)
GET  /session                  (401 if no session; returns {session,user})
/onboarding  /account  /course  /domain  /hls  /transcripts  /mail  /media  /jobs  /license
/organization  /organization/sso  /organization/token-auth  /sso  /dash  /reports
/notifications  /messages  /announcements  /community  /invite
/org-site/course  /org-site/og  /public-api/v1  /cohort  /caseload  /lms  /register
/unsplash  /widgets  /internal  /agent  /log
GET/USE /admin/queues  (BullMQ Workbench, mounted after the chain)
```

Sub-mounts: `/course` => `/katex`, `/:courseId/{payment-request,content,compliance,section,lesson,exercise,submission,attendance,mark,newsfeed,members,invites,ai-tutor}`, `/presign`; `/course/:courseId/lesson/:lessonId` => `/language`, `/coursework`. `/organization` => `/automation,/course-import,/search,/tags,/widgets,/assets,/ai-tutor,/member/email-notifications,/users,/management,/allocations,/registrations,/id-verification,/:orgId/quiz`. `/agent` => `/history,/runs` (+ `b64EnvelopeRewrite` router middleware). `/internal` => `/compliance,/analytics,/account`. `/public-api/v1` => `/audience,/courses`.

Error handling: `AppError` with 4xx => its own status/message; anything else => `{success:false,error:'Internal Server Error',code:'INTERNAL_ERROR',correlationId}` 500 + Sentry + `system_event_log` row (`recordApiError`). Typed RPC client exported (`apps/api/src/rpc-types.ts`); OpenAPI/Scalar docs at `/docs`.

#### 1.2 Authentication mechanisms

| Mechanism | Where | How |
|---|---|---|
| Browser session (Better Auth cookie, prefix `classroomio`, 7-day session per Phase 10 O1, 1h cookie cache) | almost every route | `authMiddleware` (`middlewares/auth.ts`) = `c.user && c.session` else 401 |
| Actor guards (fresh role/status from DB) | newer Pearl routes | `requireActor/requireRole/requireAdmin/requireStaff/requireManagerOrAdmin/requireAdminOrApiKey` (`middlewares/guards/require-role.ts`) |
| `PRIVATE_SERVER_KEY` bearer | dashboard SSR to API, webhooks, internal cron | `apiKeyMiddleware` (`Authorization: Bearer <PRIVATE_SERVER_KEY>`, exact compare); `authOrApiKeyMiddleware` = session OR key; `requireAdminOrApiKey` = key OR ADMIN session. Used by `/mail`, `/register*`, `/invite/*/preview`, `/internal/*`, `/license/features`, `/organization` list, plan routes, `/agent/credits/purchase`, `/log/client` (trusted SSR callers) |
| Org automation key (`organization_api_key`, hashed secret, scopes) | `/public-api/v1/*`, MCP/automation variants of course/exercise/org routes | `automationKeyMiddleware` (bearer; sets `automationKey`,`orgId`,`actorId`) + `automationKeyScopesMiddleware(['public_api:*'])` for v1; `authOrAutomationKeyMiddleware` + `*OrAutomationKeyMiddleware` + `assertMcpAutomationUsageAllowed`/`recordMcpAutomationUsage` (writes `organization_automation_usage`) for session-or-key routes. Keys are created in `/organization/automation/keys` (Admin) |
| Queue dashboard | `/admin/queues` | dev: open. prod: HTTP Basic, password = `QUEUE_DASHBOARD_PASSWORD`; unmounted if unset in prod |
| HLS playback cookie `cio_hls` | `/hls/:assetId/*`, `/transcripts/:assetId/track.vtt` | signed cookie (`HLS_SIGNING_SECRET`) or session with org membership; no authMiddleware (public lessons) |
| Public (no auth) | `/org-site/*`, `/widgets/:publicKey/payload` (IP/key rate-limited), `/sso/*`, `/course/slug/:slug`, `/course/katex`, `/organization/{courses/public,setup,tags/public}`, `/dash/track` (optional user), `/health`, `/unsplash` (rate-limited), `/log/client` (30/min/IP) | |

Org guard semantics (legacy, read the **cookie-cached** `orgRoles` map and the `cio-org-id` header): `orgMemberMiddleware` (any role in org), `orgTeamMemberMiddleware` (ADMIN or TUTOR), `orgAdminMiddleware` (ADMIN). Course/cohort scope guards (DB lookups on path id): `courseMemberMiddleware` (group member OR org admin, with program backfill), `courseTeamMemberMiddleware` (course ADMIN/TUTOR OR org admin), `cohortMemberMiddleware`, `cohortTeamMemberMiddleware`, plus author-or-team guards for community/newsfeed comments. Pearl guards in `middlewares/guards/ownership.ts`: `requireSameOrg` (header/query/param org must equal `actor.orgId`), `requireSelfParam`, `requireMarkingAccess` (ADMIN, or TUTOR if `isAllocatedTutor`), `bindSubmissionToCourse` (404 on course mismatch), `requireCourseContentRead` (staff always; learner = enrolled + published + unit unlocked), `requireCourseworkSubmit` (LEARNER, enrolled, published, unit unlocked), `assertCourseMaterialDownloadAccess`, `assertCourseworkDownloadAccess`, `canReadCoursework` (self / allocated tutor / admin), `canReadLearnerProgress`, `isUnitUnlocked`. Other middleware: `workspaceNotReadOnlyMiddleware` (blocks mutations when `organization.read_only_until` in future), `blockWhenSelfHosted` (404 when `PUBLIC_IS_SELFHOSTED=true`; applied to `/public-api/v1` and `/organization/automation`), `requireLicense(feature)` (SSO, token-auth; on self-hosted `getLicenseStatus()` returns all features licensed locally, no phone-home), `signupGuard` (on `/api/auth/sign-up/*`).

Guard-chain notes for the tables below: guard names are extracted from the route definitions; "in-service/inline" lists `is*/can*/assert*` predicates called inside the handler. Rows with no guard are public as listed above. "Purpose" is derived from the service function name (every service function lives under `apps/api/src/services/**`; the router file for each table row group is `apps/api/src/routes/<group>/...`). `authMiddleware` may be implicit inside `courseMemberMiddleware` etc. (they 401 on missing user).

#### 1.3 Routes outside the generated tables

| Method | Path | Guard | Handler | Purpose |
|---|---|---|---|---|
| GET | `/health` | none | inline (`app.ts`) | liveness `{status:'ok'}` (DO uptime check) |
| GET | `/` | none | inline | welcome JSON |
| GET | `/session` | session (inline 401) | inline | return session+user |
| POST/GET | `/api/auth/*` | `signupGuard` on sign-up; Better Auth internal | `auth.handler` (`@cio/db/auth`) | sign-in/out, reset-password, verify-email, change-email, login-link, admin.createUser (server-only), token-exchange/sso (OFF on self-hosted). `sign-up/email` is disabled (`EMAIL_AND_PASSWORD_SIGN_UP_IS_NOT_ENABLED`), social returns `SOCIAL_AUTH_NOT_ENABLED` without Google keys |
| OPTIONS, GET/HEAD | `/hls/:assetId/*` | cookie `cio_hls` or session+org membership (`apps/api/src/routes/hls/hls.ts`) | inline | stream HLS manifest/segments from object storage |
| OPTIONS, GET/HEAD | `/transcripts/:assetId/track.vtt` | session org role / cookie (`routes/transcripts/transcripts.ts`) | inline | WebVTT track |
| GET/USE | `/admin/queues[/*]` | Basic auth (prod) | `@getworkbench/hono` | BullMQ UI |

#### 1.4 Generated route tables (431 handlers)

##### Auth, session & onboarding (/api/auth, /session, /onboarding, /account, /sso)

| Method | Path | Guard chain | Service function | Purpose (derived from service name) |
|---|---|---|---|---|
| GET | `/account` | authMiddleware | getAccountData | get account data |
| PUT | `/account/profile` | authMiddleware | updateUser | update user |
| POST | `/account/view-as-student-token` | authMiddleware | createViewAsStudentToken | create view as student token |
| POST | `/account/change-password` | authMiddleware | updateProfile | update profile |
| POST | `/account/heartbeat` | authMiddleware | touchSession | touch session |
| POST | `/account/stop-impersonating` | authMiddleware | mintReturnToAdminToken | mint return to admin token |
| GET | `/account/profile` | authMiddleware | getProfileById | get profile by id |
| GET | `/account/workspaces` | authMiddleware, orgAdminMiddleware | listAccountWorkspaces, getWorkspaceLimits | list account workspaces |
| POST | `/account/workspaces` | authMiddleware, orgAdminMiddleware | createWorkspaceForAccount | create workspace for account |
| DELETE | `/account/workspaces/:workspaceId` | authMiddleware, orgAdminMiddleware | deleteWorkspaceFromAccount | delete workspace from account |
| GET | `/account/usage` | authMiddleware, orgAdminMiddleware | getAccountUsage | get account usage |
| POST | `/onboarding/create-org` | authMiddleware | createOrganizationWithOwner | create organization with owner |
| POST | `/onboarding/update-metadata` | authMiddleware | updateUserOnboarding | update user onboarding |
| POST | `/onboarding/complete` | authMiddleware | completeOnboarding | complete onboarding |
| GET | `/sso/discover` | none (public) | discoverSso | discover sso |
| GET | `/sso/org/:orgId` | none (public) | getOrgSsoInfo | get org sso info |

##### Course core (/course)

| Method | Path | Guard chain | Service function | Purpose (derived from service name) |
|---|---|---|---|---|
| GET | `/course/slug/:slug` | none (public) | getCourse | get course |
| POST | `/course` | requireAdmin | createCourse | create course |
| POST | `/course/:courseId/enroll` | authMiddleware, enrollRateLimit | enrollInCourse, extractClientIp | enroll in course |
| GET | `/course/:courseId/tags` | authMiddleware, orgMemberMiddleware | getCourseTags | get course tags |
| PUT | `/course/:courseId/tags` | requireAdmin | replaceCourseTags | replace course tags |
| GET | `/course/:courseId` | courseMemberMiddleware | getCourse | get course |
| GET | `/course/:courseId/unlock` | courseMemberMiddleware | getCourseUnlockMap | get course unlock map |
| GET | `/course/:courseId/learner-progress` | courseMemberMiddleware | getOwnCourseProgress | get own course progress |
| PUT | `/course/:courseId/landing-page` | authOrAutomationKeyMiddleware, courseTeamMemberOrAutomationKeyMiddleware ; in-service/inline: assertMcpAutomationUsageAllowed | updateCourseLandingPageService, recordMcpAutomationUsage | update course landing page |
| PUT | `/course/:courseId` | requireAdmin | sanitizeHtml, updateCourse, replaceCourseTags | sanitize html |
| DELETE | `/course/:courseId` | requireAdmin | deleteCourse | delete course |
| GET | `/course/:courseId/progress` | authMiddleware, courseMemberMiddleware ; in-service/inline: canReadLearnerProgress | getCourseProgress | get course progress |
| GET | `/course/:courseId/certification-evaluation` | authMiddleware, courseMemberMiddleware | evaluateCourseCertification | evaluate course certification |
| GET | `/course/:courseId/analytics` | authMiddleware, courseTeamMemberMiddleware | getCourseAnalytics | get course analytics |
| POST | `/course/:courseId/download/certificate` | authMiddleware, courseMemberMiddleware | generateCertificatePdf | generate certificate pdf |
| POST | `/course/:courseId/download/certificate/png` | authMiddleware, courseMemberMiddleware | generateCertificatePng | generate certificate png |
| POST | `/course/:courseId/download/content` | authMiddleware, courseMemberMiddleware | generateCoursePdf | generate course pdf |
| POST | `/course/:courseId/clone` | authMiddleware, requireAdmin | getCourseOrgId, cloneCourse | get course org id |
| POST | `/course/:courseId/section` | requireAdmin | createCourseSection | create course section |
| POST | `/course/:courseId/section/promote-ungrouped` | requireAdmin | promoteUngroupedSection | promote ungrouped section |
| PUT | `/course/:courseId/section/:sectionId` | requireAdmin | updateCourseSectionService | update course section |
| DELETE | `/course/:courseId/section/:sectionId` | requireAdmin | deleteCourseSectionService | delete course section |
| POST | `/course/:courseId/section/reorder` | requireAdmin | reorderCourseSections | reorder course sections |
| GET | `/course/:courseId/lesson` | authMiddleware, courseMemberMiddleware | listLessons | list lessons |
| POST | `/course/:courseId/lesson/reorder` | requireAdmin | reorderLessons | reorder lessons |
| GET | `/course/:courseId/lesson/:lessonId` | authMiddleware, courseMemberMiddleware, requireCourseContentRead ; in-service/inline: assertEnrolledStudentContentAccess | getLesson, getLessonWatchProgressService | get lesson |
| POST | `/course/:courseId/lesson` | requireAdmin | createLesson | create lesson |
| PUT | `/course/:courseId/lesson/:lessonId` | requireAdmin | updateLessonService | update lesson |
| POST | `/course/:courseId/lesson/:lessonId/notify-session-update` | authMiddleware, courseTeamMemberMiddleware | notifyCourseSessionUpdateService | notify course session update |
| DELETE | `/course/:courseId/lesson/:lessonId` | requireAdmin | deleteLessonService | delete lesson |
| GET | `/course/:courseId/lesson/:lessonId/comment` | authMiddleware, courseMemberMiddleware | getLessonCommentsPaginated | get lesson comments paginated |
| POST | `/course/:courseId/lesson/:lessonId/comment` | authMiddleware, courseMemberMiddleware | getGroupMemberIdByCourseAndProfile, createLessonCommentService | get group member id by course and profile |
| PUT | `/course/:courseId/lesson/comment/:commentId` | authMiddleware, courseMemberMiddleware | updateLessonCommentService | update lesson comment |
| DELETE | `/course/:courseId/lesson/comment/:commentId` | authMiddleware, courseMemberMiddleware | deleteLessonCommentService | delete lesson comment |
| GET | `/course/:courseId/lesson/:lessonId/completion` | authMiddleware, courseMemberMiddleware | getLessonCompletionService | get lesson completion |
| PUT | `/course/:courseId/lesson/:lessonId/completion` | authMiddleware, courseMemberMiddleware ; in-service/inline: assertEnrolledStudentContentAccess | upsertLessonCompletionService, evaluateCourseCertification | upsert lesson completion |
| GET | `/course/:courseId/lesson/:lessonId/watch-progress` | authMiddleware, courseMemberMiddleware ; in-service/inline: assertEnrolledStudentContentAccess | getLessonWatchProgressService | get lesson watch progress |
| PUT | `/course/:courseId/lesson/:lessonId/watch-progress` | authMiddleware, courseMemberMiddleware ; in-service/inline: assertEnrolledStudentContentAccess | updateLessonWatchProgressService, evaluateCourseCertification | update lesson watch progress |
| PUT | `/course/:courseId/lesson/:lessonId/time` | authMiddleware, unitTimeRateLimit, courseMemberMiddleware ; in-service/inline: assertEnrolledStudentContentAccess | addUnitTimeSpent | add unit time spent |
| GET | `/course/:courseId/lesson/:lessonId/history` | authMiddleware, courseMemberMiddleware | getLessonHistoryService | get lesson history |
| POST | `/course/:courseId/lesson/download/pdf` | courseMemberMiddleware | generateLessonPdf | generate lesson pdf |
| GET | `/course/:courseId/lesson/:lessonId/language` | authMiddleware, courseMemberMiddleware, requireCourseContentRead [router-level: b64EnvelopeRewrite] | listLessonLanguages | list lesson languages |
| GET | `/course/:courseId/lesson/:lessonId/language/:locale` | authMiddleware, courseMemberMiddleware, requireCourseContentRead [router-level: b64EnvelopeRewrite] | getLessonLanguage | get lesson language |
| POST | `/course/:courseId/lesson/:lessonId/language` | requireAdmin [router-level: b64EnvelopeRewrite] | upsertLessonLanguageService | upsert lesson language |
| PUT | `/course/:courseId/lesson/:lessonId/language/:locale` | requireAdmin [router-level: b64EnvelopeRewrite] | updateLessonLanguageService | update lesson language |
| PUT | `/course/:courseId/content/reorder` | authOrAutomationKeyMiddleware, courseTeamMemberOrAutomationKeyMiddleware ; in-service/inline: assertMcpAutomationUsageAllowed | reorderCourseContent, recordMcpAutomationUsage | reorder course content |
| PUT | `/course/:courseId/content` | requireAdmin | updateCourseContent | update course content |
| DELETE | `/course/:courseId/content` | requireAdmin | deleteCourseContent | delete course content |
| GET | `/course/:courseId/exercise` | authOrAutomationKeyMiddleware, courseMemberOrAutomationKeyMiddleware ; in-service/inline: assertMcpAutomationUsageAllowed | listExercises, recordMcpAutomationUsage | list exercises |
| GET | `/course/:courseId/exercise/:exerciseId/submissions` | authMiddleware, courseMemberMiddleware | listExerciseSubmissionsOverview | list exercise submissions overview |
| POST | `/course/:courseId/exercise/:exerciseId/notify` | authMiddleware, courseTeamMemberMiddleware | notifyCourseExerciseService | notify course exercise |
| GET | `/course/:courseId/exercise/:exerciseId/notify/:jobId` | authMiddleware, courseTeamMemberMiddleware | getNotifyCourseExerciseStatusService | get notify course exercise status |
| GET | `/course/:courseId/exercise/:exerciseId` | authOrAutomationKeyMiddleware, courseMemberOrAutomationKeyMiddleware ; in-service/inline: assertMcpAutomationUsageAllowed, assertEnrolledStudentContentAccess | getExercise, recordMcpAutomationUsage | get exercise |
| POST | `/course/:courseId/exercise` | authOrAutomationKeyMiddleware, courseTeamMemberOrAutomationKeyMiddleware ; in-service/inline: assertMcpAutomationUsageAllowed | createExercise, recordMcpAutomationUsage | create exercise |
| POST | `/course/:courseId/exercise/from-template` | authOrAutomationKeyMiddleware, courseTeamMemberOrAutomationKeyMiddleware ; in-service/inline: assertMcpAutomationUsageAllowed | fetchTemplateById, createExerciseFromTemplate, recordMcpAutomationUsage | fetch template by id |
| PUT | `/course/:courseId/exercise/:exerciseId` | authOrAutomationKeyMiddleware, courseTeamMemberOrAutomationKeyMiddleware ; in-service/inline: assertMcpAutomationUsageAllowed, isCourseTeamMemberOrOrgAdmin | updateExerciseService, recordMcpAutomationUsage | update exercise |
| DELETE | `/course/:courseId/exercise/:exerciseId` | authMiddleware, courseTeamMemberMiddleware | deleteExerciseForCourseService | delete exercise for course |
| POST | `/course/:courseId/exercise/:exerciseId/submission` | authMiddleware, courseMemberMiddleware ; in-service/inline: assertEnrolledStudentContentAccess | getGroupMemberIdByCourseAndProfile, createSubmissionService | get group member id by course and profile |
| POST | `/course/:courseId/exercise/:exerciseId/question/:questionId/video-recording/upload/init` | authMiddleware, courseMemberMiddleware | initVideoRecordingUpload | init video recording upload |
| POST | `/course/:courseId/exercise/:exerciseId/question/:questionId/video-recording/upload/complete` | authMiddleware, courseMemberMiddleware | completeVideoRecordingUpload | complete video recording upload |
| GET | `/course/:courseId/exercise/:exerciseId/submission/:submissionId/question/:questionId/video-recording/playback` | authMiddleware, courseMemberMiddleware | getVideoRecordingPlaybackUrl | get video recording playback url |
| GET | `/course/:courseId/exercise/template` | authMiddleware, courseMemberMiddleware | fetchAllTemplatesMetadata | fetch all templates metadata |
| GET | `/course/:courseId/exercise/template/:id` | authMiddleware, courseMemberMiddleware | fetchTemplateById | fetch template by id |
| GET | `/course/:courseId/exercise/template/tag/:tag` | authMiddleware, courseMemberMiddleware | fetchTemplatesByTag | fetch templates by tag |
| GET | `/course/:courseId/submission/for-grading` | requireMarkingAccess | listSubmissionsForGrading | list submissions for grading |
| PUT | `/course/:courseId/submission/:submissionId` | requireMarkingAccess, bindSubmissionToCourse | updateSubmissionService | update submission |
| DELETE | `/course/:courseId/submission/:submissionId` | requireMarkingAccess, bindSubmissionToCourse | deleteSubmissionService | delete submission |
| PUT | `/course/:courseId/submission/:submissionId/answer` | requireMarkingAccess, bindSubmissionToCourse | updateSubmissionAnswer | update submission answer |
| PUT | `/course/:courseId/submission/:submissionId/grades` | requireMarkingAccess, bindSubmissionToCourse | updateSubmissionGradesBatch | update submission grades batch |
| GET | `/course/:courseId/mark/gradebook` | requireMarkingAccess | getGradebook | get gradebook |
| GET | `/course/:courseId/mark` | requireMarkingAccess | getMarks | get marks |
| POST | `/course/:courseId/lesson/:lessonId/coursework/presign` | requireCourseworkSubmit | presignCourseworkUploads | presign coursework uploads |
| POST | `/course/:courseId/lesson/:lessonId/coursework` | requireCourseworkSubmit | createCourseworkSubmission | create coursework submission |
| GET | `/course/:courseId/lesson/:lessonId/coursework` | requireActor | listOwnCourseworkForUnit | list own coursework for unit |
| POST | `/course/:courseId/lesson/:lessonId/coursework/download` | requireActor ; in-service/inline: assertCourseworkDownloadAccess | signCourseworkDownloads | sign coursework downloads |
| GET | `/course/:courseId/lesson/:lessonId/coursework/:submissionId` | requireActor | getCourseworkSubmissionForReader | get coursework submission for reader |
| POST | `/course/:courseId/attendance` | requireStaff | upsertAttendanceService | upsert attendance |
| GET | `/course/:courseId/newsfeed` | authMiddleware, courseMemberMiddleware | listNewsfeedPaginated | list newsfeed paginated |
| GET | `/course/:courseId/newsfeed/:feedId` | authMiddleware, courseMemberMiddleware | getNewsfeedItem | get newsfeed item |
| POST | `/course/:courseId/newsfeed` | authMiddleware, courseTeamMemberMiddleware | getGroupMemberIdByCourseAndProfile, createNewsfeedService | get group member id by course and profile |
| PUT | `/course/:courseId/newsfeed/:feedId` | authMiddleware, courseTeamMemberMiddleware | updateNewsfeedService | update newsfeed |
| PUT | `/course/:courseId/newsfeed/:feedId/react` | authMiddleware, courseMemberMiddleware | updateNewsfeedReactionService | update newsfeed reaction |
| DELETE | `/course/:courseId/newsfeed/:feedId` | authMiddleware, courseTeamMemberMiddleware | deleteNewsfeedService | delete newsfeed |
| GET | `/course/:courseId/newsfeed/:feedId/comments` | authMiddleware, courseMemberMiddleware | getNewsfeedCommentsService | get newsfeed comments |
| POST | `/course/:courseId/newsfeed/:feedId/comment` | authMiddleware, courseMemberMiddleware | getGroupMemberIdByCourseAndProfile, createNewsfeedCommentService | get group member id by course and profile |
| PUT | `/course/:courseId/newsfeed/comment/:commentId` | authMiddleware, newsfeedCommentAuthorOnlyMiddleware | updateNewsfeedCommentService | update newsfeed comment |
| DELETE | `/course/:courseId/newsfeed/comment/:commentId` | authMiddleware, newsfeedCommentAuthorOrTeamMiddleware | deleteNewsfeedCommentService | delete newsfeed comment |
| GET | `/course/:courseId/members` | requireAdmin | listCourseMembers | list course members |
| POST | `/course/:courseId/members` | requireAdmin | addMembers | add members |
| PUT | `/course/:courseId/members/:memberId` | requireAdmin | updateMember | update member |
| DELETE | `/course/:courseId/members/:memberId` | requireAdmin | deleteMember | delete member |
| POST | `/course/:courseId/members/:memberId/reset-progress` | requireAdmin | resetMemberCourseProgress | reset member course progress |
| GET | `/course/:courseId/members/:userId/analytics` | requireAdmin | getUserCourseAnalytics | get user course analytics |
| GET | `/course/:courseId/invites` | authMiddleware, courseTeamMemberMiddleware | listStudentInvites | list student invites |
| POST | `/course/:courseId/invites` | authMiddleware, courseTeamMemberMiddleware | createStudentInvite | create student invite |
| POST | `/course/:courseId/invites/:inviteId/revoke` | authMiddleware, courseTeamMemberMiddleware | revokeStudentInvite | revoke student invite |
| GET | `/course/:courseId/invites/:inviteId/audit` | authMiddleware, courseTeamMemberMiddleware | getStudentInviteAuditTrail | get student invite audit trail |
| GET | `/course/:courseId/compliance` | authMiddleware, courseTeamMemberMiddleware | getCourseComplianceOverview | get course compliance overview |
| GET | `/course/:courseId/compliance/learners/:profileId` | authMiddleware, courseMemberMiddleware | getLearnerComplianceHistory | get learner compliance history |
| POST | `/course/:courseId/compliance/reset` | authMiddleware, courseTeamMemberMiddleware | resetCourseCompliance | reset course compliance |
| POST | `/course/:courseId/compliance/extend` | authMiddleware, courseTeamMemberMiddleware | extendCourseCompliance | extend course compliance |
| POST | `/course/:courseId/compliance/waive` | authMiddleware, courseTeamMemberMiddleware | waiveCourseCompliance | waive course compliance |
| GET | `/course/:courseId/ai-tutor` | authMiddleware, courseTeamMemberMiddleware | getCourseAiTutorSettingsView | get course ai tutor settings view |
| PUT | `/course/:courseId/ai-tutor` | authMiddleware, courseTeamMemberMiddleware | updateCourseAiTutorOverrideService | update course ai tutor override |
| POST | `/course/:courseId/payment-request` | paymentRequestRateLimit | createPaymentRequest | create payment request |
| POST | `/course/presign/video/upload` | requireActor, uploadRateLimit ; in-service/inline: assertPresignFileSizeWithinLimit | generateFileKey, generateVideoUploadPresignedUrl | generate file key |
| POST | `/course/presign/document/upload` | requireActor, uploadRateLimit ; in-service/inline: assertPresignFileSizeWithinLimit, isRole | withTimeout, getCourseOrgId, generateMaterialFileKey | with timeout |
| POST | `/course/presign/video/download` | requireActor ; in-service/inline: assertCourseMaterialDownloadAccess | generateVideoDownloadPresignedUrls | generate video download presigned urls |
| POST | `/course/presign/document/download` | requireActor ; in-service/inline: assertCourseMaterialDownloadAccess | generateDocumentDownloadPresignedUrls | generate document download presigned urls |
| GET | `/course/katex` | none (public) | - | (inline handler) |

##### Tutor caseload, LMS (learner), progression, reports (/caseload, /lms, /reports, /dash)

| Method | Path | Guard chain | Service function | Purpose (derived from service name) |
|---|---|---|---|---|
| GET | `/caseload` | requireStaff | getTutorCaseload | get tutor caseload |
| GET | `/caseload/pipeline` | requireStaff | getTutorPipeline | get tutor pipeline |
| GET | `/caseload/progression` | requireStaff | getProgression | get progression |
| GET | `/caseload/progression/:learnerId` | requireStaff | getProgressionDetail | get progression detail |
| GET | `/caseload/learners/:learnerId` | requireStaff | getCaseloadLearnerDetail | get caseload learner detail |
| POST | `/caseload/submissions/:submissionId/result` | requireStaff | recordResult | record result |
| POST | `/caseload/submissions/:submissionId/feedback/presign` | requireStaff | presignFeedbackUploads | presign feedback uploads |
| GET | `/caseload/courses/:courseId/content` | requireStaff | getTutorCourseContent | get tutor course content |
| GET | `/caseload/courses/:courseId/lessons/:lessonId/unit` | requireStaff | getTutorUnitContent | get tutor unit content |
| POST | `/caseload/courses/:courseId/materials/download` | requireStaff | signCourseMaterialsForTutor | sign course materials for tutor |
| GET | `/caseload/courses/:courseId/lessons/:lessonId/submissions` | requireStaff, ZAssessmentKeyQuery | getAssessmentSubmissions | get assessment submissions |
| GET | `/caseload/courses/:courseId/lessons/:lessonId/submissions/download-all` | requireStaff, ZAssessmentKeyQuery | buildAssessmentSubmissionsZip | build assessment submissions zip |
| GET | `/lms/assignments` | authMiddleware | getLearnerAssignments | get learner assignments |
| GET | `/lms/dashboard` | authMiddleware | getLearnerDashboard | get learner dashboard |
| GET | `/lms/tutor-feedback` | authMiddleware, requireActor | getTutorFeedbackStatus | get tutor feedback status |
| POST | `/lms/tutor-feedback` | authMiddleware, requireActor | submitTutorFeedback | submit tutor feedback |
| GET | `/reports/progress/courses` | requireManagerOrAdmin | listOrgReportableCourses | list org reportable courses |
| GET | `/reports/progress` | requireManagerOrAdmin | getProviderProgressReport | get provider progress report |
| POST | `/dash/track` | none (public) | ingestEventBatch | ingest event batch |
| GET | `/dash/stats` | authMiddleware, requireManagerOrAdmin, requireSameOrg | getOrganisationAnalytics | get organisation analytics |
| GET | `/dash/login-activity` | authMiddleware, requireManagerOrAdmin, requireSameOrg | getStudentLoginActivity | get student login activity |
| GET | `/dash/login-streak` | authMiddleware | getCurrentUserLoginStreak | get current user login streak |
| GET | `/dash/landing-stats` | authMiddleware, requireManagerOrAdmin, requireSameOrg | getLandingStats | get landing stats |
| GET | `/dash/country-breakdown` | authMiddleware, requireManagerOrAdmin, requireSameOrg | getCountryBreakdown | get country breakdown |
| GET | `/dash/course-funnel` | authMiddleware, requireManagerOrAdmin, requireSameOrg | getCourseFunnel | get course funnel |
| GET | `/dash/popular-types` | authMiddleware, requireManagerOrAdmin, requireSameOrg | getPopularTypes | get popular types |
| GET | `/dash/compliance-overview` | authMiddleware, requireManagerOrAdmin, requireSameOrg | getOrgComplianceOverview | get org compliance overview |
| GET | `/dash/admin-overview` | authMiddleware, requireManagerOrAdmin, requireSameOrg | getAdminOverview | get admin overview |
| GET | `/dash/reports/learners` | authMiddleware, requireManagerOrAdmin | getLearnersReport | get learners report |
| GET | `/dash/reports/completions` | authMiddleware, requireManagerOrAdmin | getCompletionsReport | get completions report |
| GET | `/dash/reports/referrals` | authMiddleware, requireAdmin | getReferralsReport | get referrals report |
| GET | `/dash/reports/tutor-feedback` | authMiddleware, requireAdmin | getTutorFeedbackReport | get tutor feedback report |
| GET | `/dash/reports/activity-log` | authMiddleware, requireAdmin ; in-service/inline: isNaN, isFinite | getSystemEventsReport | get system events report |
| GET | `/dash/online-now` | authMiddleware, requireManagerOrAdmin, requireSameOrg | getOnlineNow | get online now |

##### Organization (/organization/**)

| Method | Path | Guard chain | Service function | Purpose (derived from service name) |
|---|---|---|---|---|
| GET | `/organization` | authOrApiKeyMiddleware | getOrganizationsWithFilters | get organizations with filters |
| GET | `/organization/first` | authOrApiKeyMiddleware | getFirstOrgForSelfHosted | get first org for self hosted |
| POST | `/organization/auto-join` | authMiddleware | autoJoinOrg | auto join org |
| GET | `/organization/team` | authMiddleware, requireAdmin | getOrgTeam | get org team |
| POST | `/organization/team/invite` | authMiddleware, orgAdminMiddleware | inviteTeamMembers | invite team members |
| GET | `/organization/link-invite` | authMiddleware, orgAdminMiddleware | fetchOrgLinkInvite | fetch org link invite |
| POST | `/organization/link-invite` | authMiddleware, orgAdminMiddleware | getOrCreateLinkInvite | get or create link invite |
| PATCH | `/organization/link-invite` | authMiddleware, orgAdminMiddleware | toggleOrgLinkInvite | toggle org link invite |
| DELETE | `/organization/team/:memberId` | authMiddleware, orgAdminMiddleware | removeTeamMember | remove team member |
| GET | `/organization/audience` | authMiddleware, requireAdmin | getOrgAudience | get org audience |
| DELETE | `/organization/audience/:memberId` | authMiddleware, orgAdminMiddleware | removeAudienceMember | remove audience member |
| POST | `/organization/audience/resend-invite` | authMiddleware, requireAdmin | resendAudienceInvite | resend audience invite |
| POST | `/organization/audience/revoke-invite` | authMiddleware, requireAdmin | revokeAudiencePendingInvite | revoke audience pending invite |
| GET | `/organization/audience/:userId/analytics` | authMiddleware, requireAdmin | getUserAnalytics | get user analytics |
| GET | `/organization/courses/public` | none (public) | getPublicCourses | get public courses |
| GET | `/organization/courses/enrolled` | authMiddleware, orgMemberMiddleware | getUserEnrolledCourses, overlayResultDerivedProgress | get user enrolled courses |
| GET | `/organization/courses/recommended` | authMiddleware, orgMemberMiddleware | getRecommendedCourses | get recommended courses |
| GET | `/organization/courses` | authOrAutomationKeyMiddleware, orgMemberOrAutomationKeyMiddleware ; in-service/inline: assertMcpAutomationUsageAllowed | getOrganizationCourses, recordMcpAutomationUsage | get organization courses |
| GET | `/organization/setup` | none (public) | getOrgSetupData | get org setup data |
| POST | `/organization/plan` | requireAdminOrApiKey | createOrgPlan | create org plan |
| PUT | `/organization/plan` | requireAdminOrApiKey | updateOrgPlan | update org plan |
| POST | `/organization/plan/cancel` | requireAdminOrApiKey | cancelOrgPlan | cancel org plan |
| POST | `/organization` | authMiddleware | createOrg | create org |
| PUT | `/organization` | authMiddleware, orgAdminMiddleware | updateOrg | update org |
| GET | `/organization/:orgId/exercises/lms` | authMiddleware | getLMSExercisesService | get lmsexercises |
| POST | `/organization/audience/import` | authMiddleware, requireAdmin | importAudienceMembers | import audience members |
| POST | `/organization/audience/assign-courses` | authMiddleware, requireAdmin | assignAudienceToCourses | assign audience to courses |
| GET | `/organization/users` | requireAdmin | listOrgUsers | list org users |
| POST | `/organization/users` | requireAdmin | createOrgUser | create org user |
| GET | `/organization/users/onboard/courses` | requireAdmin | listOnboardingCourses | list onboarding courses |
| POST | `/organization/users/onboard` | requireAdmin | onboardLearner | onboard learner |
| PUT | `/organization/users/:memberId/role` | requireAdmin | changeOrgUserRole | change org user role |
| PUT | `/organization/users/:memberId/status` | requireAdmin | changeOrgUserStatus | change org user status |
| GET | `/organization/users/:memberId/profile` | requireAdmin | getLearnerProfile | get learner profile |
| PUT | `/organization/users/:memberId/profile` | requireAdmin | updateLearnerProfile | update learner profile |
| GET | `/organization/management/summary` | requireAdmin | getOrgSummary | get org summary |
| GET | `/organization/management/learners` | requireAdmin | getLearnerManagement | get learner management |
| GET | `/organization/management/tutors` | requireAdmin | getTutorManagement | get tutor management |
| GET | `/organization/management/admins` | requireAdmin | getAdminManagement | get admin management |
| POST | `/organization/management/admins` | requireAdmin | createAdmin | create admin |
| GET | `/organization/management/course-options` | requireAdmin | listAssignableCourses | list assignable courses |
| GET | `/organization/management/progression` | requireAdmin | getOrgProgression | get org progression |
| GET | `/organization/management/progression/:learnerId` | requireAdmin | getProgressionDetail | get progression detail |
| GET | `/organization/management/options` | requireAdmin | listPublishedCoursesForOrg, listOrgTutors | list published courses for org |
| POST | `/organization/management/learners` | requireAdmin | createLearner | create learner |
| POST | `/organization/management/tutors` | requireAdmin | createTutor | create tutor |
| GET | `/organization/management/tutors/:memberId/courses` | requireAdmin | getTutorCourses | get tutor courses |
| PUT | `/organization/management/tutors/:memberId/courses` | requireAdmin | setTutorCourses | set tutor courses |
| POST | `/organization/management/members/:memberId/reset-password` | requireAdmin | resetUserPassword | reset user password |
| POST | `/organization/management/members/:memberId/login-as` | requireAdmin | startImpersonation | start impersonation |
| GET | `/organization/allocations` | requireManagerOrAdmin | listOrgAllocations | list org allocations |
| GET | `/organization/allocations/assignable` | requireManagerOrAdmin | getAssignablePeople | get assignable people |
| POST | `/organization/allocations` | requireManagerOrAdmin | createTutorAllocation | create tutor allocation |
| DELETE | `/organization/allocations/:allocationId` | requireManagerOrAdmin | removeTutorAllocation | remove tutor allocation |
| GET | `/organization/registrations` | requireManagerOrAdmin | listRegistrationQueue | list registration queue |
| GET | `/organization/registrations/courses` | requireManagerOrAdmin | listApprovalCourses | list approval courses |
| GET | `/organization/registrations/:id` | requireManagerOrAdmin | getRegistrationDetail | get registration detail |
| POST | `/organization/registrations/:id/approve` | requireManagerOrAdmin | approveRegistration | approve registration |
| POST | `/organization/registrations/:id/reject` | requireManagerOrAdmin | rejectRegistration | reject registration |
| GET | `/organization/id-verification/me` | requireActor | getMyIdVerification | get my id verification |
| GET | `/organization/id-verification/learner/:learnerId` | requireActor | getLearnerIdVerification | get learner id verification |
| PUT | `/organization/id-verification/learner/:learnerId` | requireActor | recordIdVerification | record id verification |
| GET | `/organization/assets` | authMiddleware, orgMemberMiddleware | listOrganizationAssetsService | list organization assets |
| GET | `/organization/assets/grouped` | authMiddleware, orgMemberMiddleware | getGroupedMedia | get grouped media |
| POST | `/organization/assets` | requireAdmin | createAssetFromUploadService | create asset from upload |
| POST | `/organization/assets/hls/init` | authMiddleware, orgTeamMemberMiddleware | initHlsAssetService | init hls asset |
| POST | `/organization/assets/:assetId/hls/presign` | authMiddleware, orgTeamMemberMiddleware | batchPresignHlsService | batch presign hls |
| POST | `/organization/assets/:assetId/hls/finalize` | authMiddleware, orgTeamMemberMiddleware | finalizeHlsAssetService | finalize hls asset |
| POST | `/organization/assets/:assetId/hls/1080/presign` | authMiddleware, orgTeamMemberMiddleware | batchPresignHls1080Service | batch presign hls1080 |
| POST | `/organization/assets/:assetId/hls/1080/finalize` | authMiddleware, orgTeamMemberMiddleware | finalizeHls1080Service | finalize hls1080 |
| DELETE | `/organization/assets/:assetId/hls` | authMiddleware, orgTeamMemberMiddleware | abortHlsAssetService | abort hls asset |
| DELETE | `/organization/assets/:assetId/hls/1080` | authMiddleware, orgTeamMemberMiddleware | abortHls1080RenditionService | abort hls1080rendition |
| POST | `/organization/assets/:assetId/hls/cookie` | authMiddleware, orgMemberMiddleware | issueHlsCookieService | issue hls cookie |
| GET | `/organization/assets/export` | authMiddleware, orgAdminMiddleware | exportOrganizationAssetsService | export organization assets |
| GET | `/organization/assets/storage` | authMiddleware, orgMemberMiddleware | getOrganizationAssetStorageService | get organization asset storage |
| GET | `/organization/assets/youtube-metadata` | authMiddleware, orgMemberMiddleware | getYouTubeMetadataService | get you tube metadata |
| GET | `/organization/assets/:assetId/transcript` | authMiddleware, orgMemberMiddleware | getTranscriptForOrganizationAssetService | get transcript for organization asset |
| PUT | `/organization/assets/:assetId/transcript` | authMiddleware, orgAdminMiddleware | updateTranscriptForOrganizationAssetService | update transcript for organization asset |
| GET | `/organization/assets/:assetId` | authMiddleware, orgMemberMiddleware | getAssetService | get asset |
| PUT | `/organization/assets/:assetId` | requireAdmin | updateAssetService | update asset |
| PUT | `/organization/assets/:assetId/thumbnail` | requireAdmin | selectAssetThumbnailService | select asset thumbnail |
| DELETE | `/organization/assets/:assetId` | authMiddleware, orgAdminMiddleware | deleteAssetService | delete asset |
| GET | `/organization/assets/:assetId/usage` | authMiddleware, orgMemberMiddleware | getAssetUsageGraphService | get asset usage graph |
| POST | `/organization/assets/:assetId/attach` | requireAdmin | attachAssetService | attach asset |
| POST | `/organization/assets/:assetId/detach` | requireAdmin | detachAssetService | detach asset |
| GET | `/organization/tags/public` | none (public) | getPublicOrganizationTagGroups | get public organization tag groups |
| GET | `/organization/tags` | authMiddleware, orgMemberMiddleware | getOrganizationTagGroups | get organization tag groups |
| POST | `/organization/tags/groups` | authMiddleware, orgAdminMiddleware | createOrganizationTagGroup | create organization tag group |
| PUT | `/organization/tags/courses/assign` | authOrAutomationKeyMiddleware, orgAdminOrAutomationKeyMiddleware ; in-service/inline: assertMcpAutomationUsageAllowed | assignTagsToCoursesByName, recordMcpAutomationUsage | assign tags to courses by name |
| PUT | `/organization/tags/groups/:groupId` | authMiddleware, orgAdminMiddleware | updateOrganizationTagGroup | update organization tag group |
| POST | `/organization/tags` | authMiddleware, orgAdminMiddleware | createOrganizationTag | create organization tag |
| PUT | `/organization/tags/:tagId` | authMiddleware, orgAdminMiddleware | updateOrganizationTag | update organization tag |
| GET | `/organization/widgets` | authMiddleware, orgTeamMemberMiddleware | listOrganizationWidgets | list organization widgets |
| POST | `/organization/widgets` | authMiddleware, orgTeamMemberMiddleware | createOrganizationWidget | create organization widget |
| GET | `/organization/widgets/:widgetId` | authMiddleware, orgTeamMemberMiddleware | getOrganizationWidgetDetail | get organization widget detail |
| PUT | `/organization/widgets/:widgetId` | authMiddleware, orgTeamMemberMiddleware | updateOrganizationWidget | update organization widget |
| DELETE | `/organization/widgets/:widgetId` | authMiddleware, orgAdminMiddleware | deleteOrganizationWidget | delete organization widget |
| POST | `/organization/widgets/:widgetId/publish` | authMiddleware, orgAdminMiddleware | publishOrganizationWidget | publish organization widget |
| POST | `/organization/widgets/:widgetId/rollback` | authMiddleware, orgAdminMiddleware | rollbackOrganizationWidget | rollback organization widget |
| GET | `/organization/search` | authMiddleware, orgAdminMiddleware | searchOrganization | search organization |
| GET | `/organization/search/lms` | authMiddleware, orgMemberMiddleware | searchLmsOrganization | search lms organization |
| GET | `/organization/:orgId/quiz` | authMiddleware, orgMemberMiddleware [router-level: requireSameOrg({ param: 'orgId' })] | listQuizzes | list quizzes |
| GET | `/organization/:orgId/quiz/:quizId` | authMiddleware, orgMemberMiddleware [router-level: requireSameOrg({ param: 'orgId' })] | getQuiz | get quiz |
| POST | `/organization/:orgId/quiz` | authMiddleware, orgMemberMiddleware [router-level: requireSameOrg({ param: 'orgId' })] | createQuizService | create quiz |
| PUT | `/organization/:orgId/quiz/:quizId` | authMiddleware, orgMemberMiddleware [router-level: requireSameOrg({ param: 'orgId' })] | updateQuizService | update quiz |
| DELETE | `/organization/:orgId/quiz/:quizId` | authMiddleware, orgMemberMiddleware [router-level: requireSameOrg({ param: 'orgId' })] | deleteQuizService | delete quiz |
| GET | `/organization/ai-tutor` | authMiddleware, orgMemberMiddleware | getResolvedOrgAiTutorSettings | get resolved org ai tutor settings |
| PUT | `/organization/ai-tutor` | authMiddleware, orgAdminMiddleware | updateOrgAiTutorSettingsService | update org ai tutor settings |
| GET | `/organization/member/email-notifications` | authMiddleware, orgMemberMiddleware | getMemberEmailNotificationPreferences | get member email notification preferences |
| PUT | `/organization/member/email-notifications` | authMiddleware, orgMemberMiddleware | updateMemberEmailNotificationPreferences | update member email notification preferences |
| GET | `/organization/automation/usage` | authMiddleware, orgAdminMiddleware [router-level: blockWhenSelfHosted] | getOrganizationAutomationUsageSummaryService | get organization automation usage summary |
| GET | `/organization/automation/keys` | authMiddleware, orgAdminMiddleware, ZListOrganizationApiKeysQuery [router-level: blockWhenSelfHosted] | listOrganizationApiKeysService | list organization api keys |
| POST | `/organization/automation/keys` | authMiddleware, orgAdminMiddleware, ZCreateOrganizationApiKey [router-level: blockWhenSelfHosted] | createOrganizationApiKeyService | create organization api key |
| DELETE | `/organization/automation/keys/:keyId` | authMiddleware, orgAdminMiddleware, ZOrganizationApiKeyParam [router-level: blockWhenSelfHosted] | revokeOrganizationApiKeyService | revoke organization api key |
| POST | `/organization/automation/keys/:keyId/rotate` | authMiddleware, orgAdminMiddleware, ZOrganizationApiKeyParam [router-level: blockWhenSelfHosted] | rotateOrganizationApiKeyService | rotate organization api key |
| GET | `/organization/course-import/courses/:courseId/structure` | authOrAutomationKeyMiddleware, orgAdminOrAutomationKeyMiddleware ; in-service/inline: assertMcpAutomationUsageAllowed | getCourseImportStructureService, recordMcpAutomationUsage | get course import structure |
| POST | `/organization/course-import/drafts` | authOrAutomationKeyMiddleware, orgAdminOrAutomationKeyMiddleware ; in-service/inline: assertMcpAutomationUsageAllowed | createCourseImportDraftService, recordMcpAutomationUsage | create course import draft |
| POST | `/organization/course-import/drafts/from-course` | authOrAutomationKeyMiddleware, orgAdminOrAutomationKeyMiddleware ; in-service/inline: assertMcpAutomationUsageAllowed | createCourseImportDraftFromCourseService, recordMcpAutomationUsage | create course import draft from course |
| GET | `/organization/course-import/drafts/:draftId` | authOrAutomationKeyMiddleware, orgAdminOrAutomationKeyMiddleware ; in-service/inline: assertMcpAutomationUsageAllowed | getCourseImportDraftService, recordMcpAutomationUsage | get course import draft |
| PUT | `/organization/course-import/drafts/:draftId/tags` | authOrAutomationKeyMiddleware, orgAdminOrAutomationKeyMiddleware ; in-service/inline: assertMcpAutomationUsageAllowed | updateCourseImportDraftTagsService, recordMcpAutomationUsage | update course import draft tags |
| PUT | `/organization/course-import/drafts/:draftId` | authOrAutomationKeyMiddleware, orgAdminOrAutomationKeyMiddleware ; in-service/inline: assertMcpAutomationUsageAllowed | updateCourseImportDraftService, recordMcpAutomationUsage | update course import draft |
| POST | `/organization/course-import/drafts/:draftId/publish` | authOrAutomationKeyMiddleware, orgAdminOrAutomationKeyMiddleware ; in-service/inline: assertMcpAutomationUsageAllowed | publishCourseImportDraftService, recordMcpAutomationUsage | publish course import draft |
| POST | `/organization/course-import/drafts/:draftId/publish-existing-course` | authOrAutomationKeyMiddleware, orgAdminOrAutomationKeyMiddleware ; in-service/inline: assertMcpAutomationUsageAllowed | publishCourseImportDraftToExistingCourseService, recordMcpAutomationUsage | publish course import draft to existing course |
| GET | `/organization/sso` | authMiddleware, orgAdminMiddleware [router-level: requireLicense(LICENSE_FEATURE.SSO)] | getSsoConnection | get sso connection |
| POST | `/organization/sso` | authMiddleware, orgAdminMiddleware [router-level: requireLicense(LICENSE_FEATURE.SSO)] | createSsoConnection | create sso connection |
| PUT | `/organization/sso` | authMiddleware, orgAdminMiddleware [router-level: requireLicense(LICENSE_FEATURE.SSO)] | updateSsoConnection | update sso connection |
| DELETE | `/organization/sso` | authMiddleware, orgAdminMiddleware [router-level: requireLicense(LICENSE_FEATURE.SSO)] | deleteSsoConnection | delete sso connection |
| POST | `/organization/sso/activate` | authMiddleware, orgAdminMiddleware [router-level: requireLicense(LICENSE_FEATURE.SSO)] | activateSsoConnection | activate sso connection |
| GET | `/organization/sso/policy` | authMiddleware, orgAdminMiddleware [router-level: requireLicense(LICENSE_FEATURE.SSO)] | getSsoConnection | get sso connection |
| PUT | `/organization/sso/policy` | authMiddleware, orgAdminMiddleware [router-level: requireLicense(LICENSE_FEATURE.SSO)] | updateSsoPolicy | update sso policy |
| GET | `/organization/token-auth` | authMiddleware, orgAdminMiddleware [router-level: requireLicense(LICENSE_FEATURE.TOKEN_AUTH)] | getTokenAuthStatus | get token auth status |
| POST | `/organization/token-auth` | authMiddleware, orgAdminMiddleware [router-level: requireLicense(LICENSE_FEATURE.TOKEN_AUTH)] | createTokenAuthConfig | create token auth config |
| POST | `/organization/token-auth/rotate` | authMiddleware, orgAdminMiddleware [router-level: requireLicense(LICENSE_FEATURE.TOKEN_AUTH)] | rotateTokenAuthSecret | rotate token auth secret |
| DELETE | `/organization/token-auth` | authMiddleware, orgAdminMiddleware [router-level: requireLicense(LICENSE_FEATURE.TOKEN_AUTH)] | deleteTokenAuthConfig | delete token auth config |
| PUT | `/organization/token-auth/activate` | authMiddleware, orgAdminMiddleware [router-level: requireLicense(LICENSE_FEATURE.TOKEN_AUTH)] | activateTokenAuth | activate token auth |

##### Comms (/notifications, /messages, /announcements)

| Method | Path | Guard chain | Service function | Purpose (derived from service name) |
|---|---|---|---|---|
| GET | `/notifications` | requireActor | getNotificationCentre | get notification centre |
| POST | `/notifications/read-all` | requireActor | markAllOwnNotificationsRead | mark all own notifications read |
| GET | `/notifications/preferences` | requireActor | getMyPreferences | get my preferences |
| PUT | `/notifications/preferences/:category` | requireActor | setMyPreference | set my preference |
| POST | `/notifications/:id/read` | requireActor | markOwnNotificationRead | mark own notification read |
| GET | `/messages/my-tutor` | requireActor | getMyTutor | get my tutor |
| GET | `/messages/threads` | requireActor | listConversations | list conversations |
| POST | `/messages/open` | requireActor | openThread | open thread |
| GET | `/messages/threads/:threadId` | requireActor | getThreadView | get thread view |
| POST | `/messages/threads/:threadId/messages` | requireActor | sendMessage | send message |
| POST | `/messages/threads/:threadId/read` | requireActor | markThreadRead | mark thread read |
| GET | `/announcements` | requireActor | listAnnouncements | list announcements |
| GET | `/announcements/courses` | requireAdmin | listAnnouncementCourses | list announcement courses |
| GET | `/announcements/tutors` | requireAdmin | listAnnouncementTutors | list announcement tutors |
| GET | `/announcements/learners` | requireAdmin | listAnnouncementLearners | list announcement learners |
| GET | `/announcements/course/:courseId` | requireActor | listCourseAnnouncements | list course announcements |
| POST | `/announcements` | requireAdmin | publishAnnouncement | publish announcement |
| POST | `/announcements/:id/archive` | requireAdmin | archiveAnnouncement | archive announcement |
| DELETE | `/announcements/:id` | requireAdmin | deleteAnnouncement | delete announcement |

##### Cohorts & community (/cohort, /community)

| Method | Path | Guard chain | Service function | Purpose (derived from service name) |
|---|---|---|---|---|
| GET | `/cohort/enrolled` | authMiddleware | getEnrolledCohorts | get enrolled cohorts |
| GET | `/cohort` | requireAdmin, requireSameOrg | listOrgCohorts | list org cohorts |
| POST | `/cohort` | requireAdmin | createCohort | create cohort |
| GET | `/cohort/:cohortId` | authMiddleware, cohortMemberMiddleware | getCohort | get cohort |
| PUT | `/cohort/:cohortId` | authMiddleware, cohortTeamMemberMiddleware | updateCohort | update cohort |
| DELETE | `/cohort/:cohortId` | authMiddleware, cohortTeamMemberMiddleware | deleteCohort | delete cohort |
| GET | `/cohort/:cohortId/members` | authMiddleware, cohortMemberMiddleware | listCohortMembers | list cohort members |
| POST | `/cohort/:cohortId/members` | authMiddleware, cohortTeamMemberMiddleware | addCohortMembers | add cohort members |
| PUT | `/cohort/:cohortId/members/:memberId` | authMiddleware, cohortTeamMemberMiddleware | updateCohortMemberService | update cohort member |
| DELETE | `/cohort/:cohortId/members/:memberId` | authMiddleware, cohortTeamMemberMiddleware | removeCohortMemberService | remove cohort member |
| POST | `/cohort/:cohortId/invite` | authMiddleware, cohortTeamMemberMiddleware | inviteStudentsToCohort | invite students to cohort |
| POST | `/cohort/:cohortId/invite/assign` | authMiddleware, cohortTeamMemberMiddleware | assignExistingStudentsToCohort | assign existing students to cohort |
| GET | `/cohort/:cohortId/courses` | authMiddleware, cohortMemberMiddleware | listCohortCourses | list cohort courses |
| POST | `/cohort/:cohortId/courses` | authMiddleware, cohortTeamMemberMiddleware | addCourseToCohortService | add course to cohort |
| DELETE | `/cohort/:cohortId/courses/:courseId` | authMiddleware, cohortTeamMemberMiddleware | removeCourseFromCohortService | remove course from cohort |
| GET | `/cohort/:cohortId/newsfeed` | authMiddleware, cohortMemberMiddleware | listCohortNewsfeed | list cohort newsfeed |
| POST | `/cohort/:cohortId/newsfeed` | authMiddleware, cohortTeamMemberMiddleware | createCohortNewsfeedService | create cohort newsfeed |
| PUT | `/cohort/:cohortId/newsfeed/:feedId` | authMiddleware, cohortTeamMemberMiddleware | updateCohortNewsfeedService | update cohort newsfeed |
| PUT | `/cohort/:cohortId/newsfeed/:feedId/react` | authMiddleware, cohortMemberMiddleware | updateCohortNewsfeedReactionService | update cohort newsfeed reaction |
| DELETE | `/cohort/:cohortId/newsfeed/:feedId` | authMiddleware, cohortTeamMemberMiddleware | deleteCohortNewsfeedService | delete cohort newsfeed |
| GET | `/cohort/:cohortId/newsfeed/:feedId/comments` | authMiddleware, cohortMemberMiddleware | listCohortNewsfeedComments | list cohort newsfeed comments |
| POST | `/cohort/:cohortId/newsfeed/:feedId/comment` | authMiddleware, cohortMemberMiddleware | createCohortNewsfeedCommentService | create cohort newsfeed comment |
| DELETE | `/cohort/:cohortId/newsfeed/:feedId/comment/:commentId` | authMiddleware, cohortNewsfeedCommentAuthorOrTeamMiddleware | deleteCohortNewsfeedCommentService | delete cohort newsfeed comment |
| GET | `/cohort/my/goals` | authMiddleware | getMyGoals | get my goals |
| GET | `/cohort/goals/overview` | authMiddleware, orgTeamMemberMiddleware | getOrgGoalsOverview | get org goals overview |
| GET | `/cohort/:cohortId/goals` | authMiddleware, cohortMemberMiddleware | listGoals | list goals |
| POST | `/cohort/:cohortId/goals` | authMiddleware, cohortTeamMemberMiddleware | createGoal | create goal |
| GET | `/cohort/:cohortId/goals/:goalId` | authMiddleware, cohortMemberMiddleware | getGoal | get goal |
| PUT | `/cohort/:cohortId/goals/:goalId` | authMiddleware, cohortTeamMemberMiddleware | updateGoal | update goal |
| DELETE | `/cohort/:cohortId/goals/:goalId` | authMiddleware, cohortTeamMemberMiddleware | removeGoal | remove goal |
| POST | `/cohort/:cohortId/goals/:goalId/archive` | authMiddleware, cohortTeamMemberMiddleware | archiveGoal | archive goal |
| POST | `/cohort/:cohortId/goals/:goalId/evaluate` | authMiddleware, cohortTeamMemberMiddleware | evaluateGoal | evaluate goal |
| POST | `/cohort/:cohortId/goals/evaluate-all` | authMiddleware, cohortTeamMemberMiddleware | evaluateCohortGoals | evaluate cohort goals |
| GET | `/community` | authMiddleware, orgMemberMiddleware, requireSameOrg | fetchCommunityQuestions | fetch community questions |
| GET | `/community/:slug` | authMiddleware, orgMemberMiddleware | fetchCommunityQuestion | fetch community question |
| POST | `/community` | authMiddleware, orgMemberMiddleware | createQuestion | create question |
| PUT | `/community/:id` | authMiddleware, questionAuthorOrTeamMiddleware | editQuestion | edit question |
| DELETE | `/community/:id` | authMiddleware, questionAuthorOrTeamMiddleware | deleteQuestion | delete question |
| POST | `/community/:id/comment` | authMiddleware, orgMemberMiddleware | createComment | create comment |
| POST | `/community/:id/upvote` | authMiddleware, orgMemberMiddleware | upvote | upvote |
| DELETE | `/community/:id/comment` | authMiddleware, commentAuthorOrTeamMiddleware | deleteComment | delete comment |
| DELETE | `/community/:questionId/comments` | authMiddleware, orgTeamMemberMiddleware | deleteCommentsByQuestionId | delete comments by question id |

##### Invites, registration, domain (/invite, /register, /domain)

| Method | Path | Guard chain | Service function | Purpose (derived from service name) |
|---|---|---|---|---|
| GET | `/invite/organization/pending` | authMiddleware, pendingInviteRateLimit | getPendingOrgInviteForUser | get pending org invite for user |
| POST | `/invite/organization/:inviteId/accept-by-id` | authMiddleware, acceptByIdRateLimit | acceptOrganizationInviteById, extractClientIp | accept organization invite by id |
| GET | `/invite/student/:token` | apiKeyMiddleware, previewInviteRateLimit | previewStudentInvite, extractClientIp | preview student invite |
| GET | `/invite/organization/:token/preview` | apiKeyMiddleware, previewOrganizationInviteRateLimit | previewOrganizationInvite, extractClientIp | preview organization invite |
| POST | `/invite/organization/:token/accept` | authMiddleware, acceptOrganizationInviteRateLimit | acceptOrganizationInvite, extractClientIp | accept organization invite |
| GET | `/invite/link/:token/preview` | apiKeyMiddleware, previewLinkInviteRateLimit | previewLinkInvite, extractClientIp | preview link invite |
| POST | `/invite/link/:token/accept` | authMiddleware, acceptLinkInviteRateLimit | acceptLinkInvite, extractClientIp | accept link invite |
| GET | `/register/courses` | apiKeyMiddleware | listRegistrationCourses | list registration courses |
| POST | `/register` | apiKeyMiddleware | submitRegistration, extractClientIp | submit registration |
| POST | `/domain` | authMiddleware, orgAdminMiddleware ; in-service/inline: assertSupportedCustomDomain | normalizeCustomDomain, connectDomain, updateOrg | normalize custom domain |

##### Public org-site, widgets, media, HLS, transcripts, misc

| Method | Path | Guard chain | Service function | Purpose (derived from service name) |
|---|---|---|---|---|
| GET | `/org-site/course/:courseSlug` | none (public) | getPublicCourseTreeService | get public course tree |
| GET | `/org-site/course/:courseSlug/item/:itemSlug` | none (public) | getPublicCourseItemService | get public course item |
| POST | `/org-site/course/:courseSlug/item/:itemSlug/hls-cookie` | none (public) | issuePublicHlsCookieService | issue public hls cookie |
| GET | `/org-site/og/:siteName` | none (public) | normalizeOrgOgSiteName, generateOrgSiteOgImage, getOrgSiteOgFallbackImageUrl | normalize org og site name |
| GET | `/widgets/:publicKey/payload` | ZWidgetPublicKeyParams, widgetPayloadIpLimiter, widgetPayloadKeyLimiter [router-level: publicApiCors] | getPublishedWidgetPayload | get published widget payload |
| POST | `/media/image` | authMiddleware | uploadImage | upload image |
| GET | `/jobs/media/:jobId` | authMiddleware, orgMemberMiddleware | getMediaJobEnvelope | get media job envelope |
| GET | `/jobs/media` | authMiddleware, orgMemberMiddleware | listMediaJobEnvelopes | list media job envelopes |
| GET | `/jobs/media/asset/:assetId` | authMiddleware, orgMemberMiddleware | listMediaJobsForAssetEnvelopes, startTranscriptionOnlyMediaJob, startThumbnailRegenJob | list media jobs for asset envelopes |
| GET | `/jobs/media/:jobId/steps` | authMiddleware, orgMemberMiddleware | getMediaJobSteps | get media job steps |
| POST | `/unsplash` | unsplashRateLimit | - | (inline handler) |
| GET | `/license/features` | authOrApiKeyMiddleware | getLicenseStatus | get license status |
| POST | `/log/client` | clientLogRateLimit ; in-service/inline: isTrustedServerApiKeyRequest | extractClientIp, recordSystemEvent | extract client ip |

##### AI agent (/agent)

| Method | Path | Guard chain | Service function | Purpose (derived from service name) |
|---|---|---|---|---|
| GET | `/agent/status` | authMiddleware, orgMemberMiddleware ; in-service/inline: isCourseTeamMemberOrOrgAdmin [router-level: b64EnvelopeRewrite] | pickAnyConfiguredProvider, getTokenBalance, getStudentTutorStatus | pick any configured provider |
| POST | `/agent/upload` | authMiddleware, orgMemberMiddleware ; in-service/inline: isCourseTeamMemberOrOrgAdmin, isOrgOnPaidPlan [router-level: b64EnvelopeRewrite] | getChatConversation, parseAndStoreDocument | get chat conversation |
| GET | `/agent/usage/purchased` | authMiddleware, orgMemberMiddleware [router-level: b64EnvelopeRewrite] | getPurchasedSummary | get purchased summary |
| GET | `/agent/usage/leaderboard` | authMiddleware, orgMemberMiddleware [router-level: b64EnvelopeRewrite] | getTeamLeaderboard | get team leaderboard |
| GET | `/agent/usage` | authMiddleware, orgMemberMiddleware [router-level: b64EnvelopeRewrite] | getDetailedUsage | get detailed usage |
| GET | `/agent/tutor-usage/leaderboard` | authMiddleware, orgMemberMiddleware [router-level: b64EnvelopeRewrite] | getTutorLearnerLeaderboard | get tutor learner leaderboard |
| GET | `/agent/tutor-usage/summary` | authMiddleware, orgMemberMiddleware [router-level: b64EnvelopeRewrite] | getTutorCapStatusSummary | get tutor cap status summary |
| GET | `/agent/tutor-usage/:userId` | authMiddleware, orgAdminMiddleware [router-level: b64EnvelopeRewrite] | getTutorLearnerDetail | get tutor learner detail |
| POST | `/agent/credits` | authMiddleware, orgAdminMiddleware [router-level: b64EnvelopeRewrite] | addCredits, getTokenBalance | add credits |
| POST | `/agent/credits/purchase` | requireAdminOrApiKey [router-level: b64EnvelopeRewrite] | recordCreditPurchase | record credit purchase |
| POST | `/agent/generate-course-title` | authMiddleware, orgMemberMiddleware [router-level: b64EnvelopeRewrite] | pickAnyConfiguredProvider, generateCourseMeta | pick any configured provider |
| POST | `/agent/generate-text` | authMiddleware, orgMemberMiddleware [router-level: b64EnvelopeRewrite] | pickAnyConfiguredProvider, enforceTokenBalance, generateFieldText | pick any configured provider |
| POST | `/agent/summarize` | authMiddleware, orgMemberMiddleware ; in-service/inline: isCourseTeamMemberOrOrgAdmin [router-level: b64EnvelopeRewrite] | summarizeConversation | summarize conversation |
| POST | `/agent/chat` | authMiddleware, orgMemberMiddleware ; in-service/inline: isCourseTeamMemberOrOrgAdmin, isOrgOnPaidPlan [router-level: b64EnvelopeRewrite] | getProviderConfigForProvider, eq, getChatConversation | get provider config for provider |
| GET | `/agent/history` | authMiddleware, orgMemberMiddleware | listChatConversations | list chat conversations |
| GET | `/agent/history/:conversationId` | authMiddleware, orgMemberMiddleware | getChatConversation | get chat conversation |
| POST | `/agent/history` | authMiddleware, orgMemberMiddleware | createChatConversation | create chat conversation |
| PUT | `/agent/history/:conversationId` | authMiddleware, orgMemberMiddleware | saveChatMessages | save chat messages |
| PATCH | `/agent/history/:conversationId` | authMiddleware, orgMemberMiddleware | getChatConversation, updateConversationTitle | get chat conversation |
| DELETE | `/agent/history/:conversationId` | authMiddleware, orgMemberMiddleware | deleteChatConversation | delete chat conversation |
| POST | `/agent/history/:conversationId/compact` | authMiddleware, orgMemberMiddleware | compactConversation | compact conversation |
| POST | `/agent/history/:conversationId/generate-title` | authMiddleware, orgMemberMiddleware | pickAnyConfiguredProvider, generateConversationTitle, updateConversationTitle | pick any configured provider |
| GET | `/agent/runs` | authMiddleware, orgMemberMiddleware | listAgentRunStates | list agent run states |
| POST | `/agent/runs` | authMiddleware, orgMemberMiddleware | createAgentRunState | create agent run state |
| GET | `/agent/runs/:runId` | authMiddleware, orgMemberMiddleware | getAgentRunState | get agent run state |
| POST | `/agent/runs/:runId/resume` | authMiddleware, orgMemberMiddleware | resumeAgentRunState | resume agent run state |
| POST | `/agent/runs/:runId/retry` | authMiddleware, orgMemberMiddleware | retryAgentRunState | retry agent run state |
| POST | `/agent/runs/:runId/cancel` | authMiddleware, orgMemberMiddleware | cancelAgentRunState | cancel agent run state |
| POST | `/agent/runs/:runId/instructions` | authMiddleware, orgMemberMiddleware | appendAgentRunInstructionState | append agent run instruction state |

##### Machine-authenticated: v1 public API, internal cron, mail

| Method | Path | Guard chain | Service function | Purpose (derived from service name) |
|---|---|---|---|---|
| GET | `/public-api/v1/audience` | automationKeyMiddleware, automationKeyScopesMiddleware | listAudienceService, handlePublicApiError | list audience |
| POST | `/public-api/v1/audience` | automationKeyMiddleware, automationKeyScopesMiddleware | createAudienceService, handlePublicApiError | create audience |
| POST | `/public-api/v1/audience/assign-courses` | automationKeyMiddleware, automationKeyScopesMiddleware | assignAudienceCoursesService, handlePublicApiError | assign audience courses |
| GET | `/public-api/v1/audience/:memberId` | automationKeyMiddleware, automationKeyScopesMiddleware | getAudienceMemberService, handlePublicApiError | get audience member |
| DELETE | `/public-api/v1/audience/:memberId` | automationKeyMiddleware, automationKeyScopesMiddleware | removeAudienceService, handlePublicApiError | remove audience |
| PUT | `/public-api/v1/audience/:memberId` | automationKeyMiddleware, automationKeyScopesMiddleware | updateAudienceService, handlePublicApiError | update audience |
| GET | `/public-api/v1/courses` | automationKeyMiddleware, automationKeyScopesMiddleware | listCoursesService, handlePublicApiError | list courses |
| POST | `/public-api/v1/courses` | automationKeyMiddleware, automationKeyScopesMiddleware | createPublicApiCourseService, handlePublicApiError | create public api course |
| GET | `/public-api/v1/courses/:courseId/students` | automationKeyMiddleware, automationKeyScopesMiddleware | listCourseStudentsService, handlePublicApiError | list course students |
| GET | `/public-api/v1/courses/:courseId/export` | automationKeyMiddleware, automationKeyScopesMiddleware | exportCourseService, handlePublicApiError | export course |
| GET | `/public-api/v1/courses/:courseId/structure` | automationKeyMiddleware, automationKeyScopesMiddleware | exportCourseService, handlePublicApiError | export course |
| PUT | `/public-api/v1/courses/:courseId/structure` | automationKeyMiddleware, automationKeyScopesMiddleware | updatePublicApiCourseStructureService, handlePublicApiError | update public api course structure |
| GET | `/public-api/v1/courses/:courseId` | automationKeyMiddleware, automationKeyScopesMiddleware | getCourseService, handlePublicApiError | get course |
| PUT | `/public-api/v1/courses/:courseId` | automationKeyMiddleware, automationKeyScopesMiddleware | updatePublicApiCourseService, handlePublicApiError | update public api course |
| DELETE | `/public-api/v1/courses/:courseId` | automationKeyMiddleware, automationKeyScopesMiddleware | deletePublicApiCourseService, handlePublicApiError | delete public api course |
| POST | `/internal/account/workspace-grace` | apiKeyMiddleware | runWorkspaceGraceCheck | run workspace grace check |
| POST | `/internal/analytics/rollup-daily` | apiKeyMiddleware ; in-service/inline: isFinite | runAnalyticsRollupDaily | run analytics rollup daily |
| POST | `/internal/compliance/send-session-reminders` | apiKeyMiddleware | enqueueSessionReminderScan | enqueue session reminder scan |
| POST | `/internal/compliance/check-expiry` | apiKeyMiddleware | runComplianceExpiryCheck | run compliance expiry check |
| POST | `/internal/compliance/send-reminders` | apiKeyMiddleware | runComplianceReminderScan | run compliance reminder scan |
| POST | `/internal/compliance/evaluate-cohort-goals` | apiKeyMiddleware | runCohortGoalEvaluationSweep | run cohort goal evaluation sweep |
| POST | `/internal/compliance/send-cohort-goal-reminders` | apiKeyMiddleware | runCohortGoalReminderScan | run cohort goal reminder scan |
| POST | `/mail` | apiKeyMiddleware | enqueueRawEmail | enqueue raw email |

Route-level quirks worth knowing: `GET /organization/:orgId/exercises/lms` and quiz routes are only `authMiddleware`/`orgMember` (quiz is org-bound via `requireSameOrg`); `/course/:courseId/exercise*` mixes legacy `courseMember` guards (the old exercise/submission stack is unused by the Pearl coursework loop); `/jobs/media/*` are `orgMember` (hardening SW-11 moved HLS/pipeline writes to team); `GET /course/:courseId` etc. rely on `courseMemberMiddleware` (DB, not `actor`) so a deactivated user is blocked by `resolveActor` only on actor-based routes - but sessions are deleted on deactivation anyway.

---

### 2. Role and permission matrix

Roles live in `role` table: **1 ADMIN, 2 TUTOR, 3 STUDENT (= LEARNER), 4 MANAGER** (`packages/utils/src/constants/roles.ts`). Org role = `organizationmember.role_id` (authoritative); course/cohort role = `groupmember.role_id` / `cohort_member.role_id`. Status = `profile.status` (`ACTIVE`/`DEACTIVATED`). Single-org deployment: `actor.orgId` is the only org.

Legend: Y = allowed; self = own records only; alloc = only for allocated learners (`tutor_allocation`); - = denied (403/401).

| Capability (guard) | ADMIN | MANAGER | TUTOR | LEARNER | anon |
|---|---|---|---|---|---|
| Sign in / sign out / reset own password / change password | Y | Y | Y | Y | login + request-reset only |
| Self-register / social / anonymous sign-in | - (disabled for everyone) | - | - | - | - |
| Public registration form (`POST /register`, bearer `PRIVATE_SERVER_KEY` from dashboard SSR) | n/a | n/a | n/a | n/a | Y (rate-limited, honeypot; writes `registration` row only) |
| Own account/profile/notifications/prefs/heartbeat | Y | Y | Y | Y | - |
| Org settings, domain, AI-tutor config, API keys (`orgAdminMiddleware`), SSO/token-auth (also license) | Y | - | - | - | - |
| User management: list/create user, change role/status, learner PII (`requireAdmin`) | Y | - | - | - | - |
| Create another ADMIN (`createAdmin`) | super admin only | - | - | - | - |
| Reset a member's password | Y except super admin & self | - | - | - | - |
| Login-as (impersonate) | Y, targets LEARNER/TUTOR only (5-min login-link token) | - | - | - | - |
| Manage tutor-to-learner allocations (`requireManagerOrAdmin`) | Y | Y | - | - | - |
| Registration approval queue (approve/reject) | Y | Y | - | - | - |
| Provider-wide progress reports `/reports/*`, `/dash/*` (stats, login-activity, compliance, landing, reports/learners, completions) | Y | Y | - | - | - |
| `/dash/reports/referrals`, `/tutor-feedback`, `/activity-log` (system_event_log viewer) | Y | - | - | - | - |
| Compose announcements (`requireAdmin` on route; doc says Admin+Manager) | Y | - (route) | - | - | - |
| Read announcements / notifications | Y | Y | Y | Y (scoped to enrolment) | - |
| Messaging (`requireActor` + in-service) | read-any, write none | excluded | allocated pair only | allocated pair only | - |
| Course CRUD, sections, lessons, tags, content (`requireAdmin`) | Y | - | - | - | - |
| Course roster/members/invites (`requireAdmin` / `courseTeamMember`) | Y | - | invites/exercise-notify as course team | - | - |
| Read course content incl. draft | Y | Y | Y | only if enrolled AND published AND unit unlocked | public org-site pages only |
| Material download (presign) | Y | Y | Y | enrolled + current material key + unlocked | - |
| Submit coursework (`requireCourseworkSubmit`) | - | - | - | Y (enrolled, published, unlocked, not already passed) | - |
| Read coursework / download files (`canReadCoursework`) | Y | - (excluded by design) | alloc | self | - |
| Record result + feedback (`/caseload/submissions/:id/result`) | Y | - | alloc | - | - |
| Caseload / pipeline / progression (`requireStaff`) | Y (org-wide) | - | alloc roster | - | - |
| Legacy marking/gradebook/submission routes (`requireMarkingAccess`) | Y | - | only if allocated (no resolver => effectively Admin only) | - | - |
| Learner progress of another learner (`canReadLearnerProgress`) | Y | Y | alloc | self | - |
| ID-verification record/read | Y | Y | alloc | own status | - |
| Attendance upsert | Y | - | Y | - | - |
| Cohort list/create (`requireAdmin`); cohort edit (cohort team); cohort read (member) | Y | - | team | member | - |
| Community (org member read/post; author-or-team edit/delete) | Y | Y | Y | Y | - |
| Media/asset library read (org member); asset/HLS authoring (team/admin) | Y | read | HLS pipeline only | read | - |
| Widgets: create/edit (team), publish/delete (admin) | Y | - | create/edit | - | public payload by key |
| AI assistant (`/agent/*`, org member; credits grant Admin; paid-plan gate) | Y | Y | Y | tutor status/chat only | - |
| Learner PII (`learner_profile`) | read/write | - | - | - (not even own) | - |
| Machine: `/public-api/v1`, `/internal/*`, `/mail` | n/a (bearer key) | | | | bearer only |

#### 2.1 Super-admin protection (derived, no column)
`getSuperAdminMemberId/ProfileId` (`packages/db/src/queries/organization/management.ts`) = the ADMIN `organizationmember` with the lowest `id` in the org. `assertNotSuperAdmin` (`apps/api/src/services/organization/users.ts`) blocks password reset, deactivation and demotion of that member; only the super admin may create admins (`createAdmin`, `services/organization/management.ts`); an admin cannot demote/deactivate self or the last active admin; deactivation deletes the user's sessions immediately. Consequence for Gecko: **the first ADMIN member row you insert becomes the permanent super admin** - insert it first.

#### 2.2 Per-learner tutor model (since `0d1eed995`, 2026-10-26)
`isAllocatedTutor(actor, learnerId)` is true only for a TUTOR actor with a `tutor_allocation(tutor_id, learner_id)` row (`isTutorAllocatedToLearner`). Course-team/groupmember TUTOR rows grant course-level access but NOT access to any learner's data. Provider-wide pairs (no per-course scoping); reallocation archives the message thread (`message_thread.archived_at`).

---

### 3. Database

#### 3.1 Inventory (119 tables, `packages/db/src/schema.ts`; relations in `relations.ts`)
Origin: 101 tables are upstream ClassroomIO (baseline); **18 are PearlLMS additions**: `audit_event, system_event_log, learner_profile, tutor_allocation, coursework_submission, coursework_result, unit_time_spent, unit_time_monthly, course_completion, notification, notification_preference, message_thread, message, message_read, announcement, tutor_feedback, registration, id_verification`. Pearl columns added to upstream tables: `profile.status` (enum member_status), `course.sequential_unlock`, `lesson.links/unit_type/is_optional`. (Schema.ts line numbers are given per table; "col*" = primary key; FK target `table` = self-reference.) Key columns column lists every column name.

#### 3.2 Tables by domain

##### Auth (Better Auth) & identity

| Table | Origin | Key columns | FKs |
|---|---|---|---|
| `user` (schema.ts:76) | upstream | id*, name, email, email_verified, image, created_at, updated_at, role, banned, ban_reason, ban_expires, is_anonymous | - |
| `session` (schema.ts:113) | upstream | id*, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id, impersonated_by | user_id>user |
| `account` (schema.ts:132) | upstream | id*, account_id, provider_id, user_id, access_token, refresh_token, id_token, access_token_expires_at, refresh_token_expires_at, scope, password, created_at, updated_at | user_id>user |
| `verification` (schema.ts:155) | upstream | id*, identifier, value, expires_at, created_at, updated_at | - |
| `sso_provider` (schema.ts:97) | upstream | id*, issuer, oidc_config, saml_config, user_id, provider_id, organization_id, domain | user_id>user |
| `profile` (schema.ts:394) | upstream + Pearl cols (status) | id*, fullname, username, avatar_url, created_at, updated_at, email, can_add_course, role, goal, source, metadata, telegram_chat_id, is_email_verified, verified_at, locale, is_restricted, status, settings | id>user |
| `learner_profile` (schema.ts:3916) | **PearlLMS** | id*, user_id, date_of_birth, ni_number, gender, ethnicity, disability, address, aeb_region, college_ref, notes, created_at, updated_at | userId>profile |

##### Org, membership, roles, invites, plans

| Table | Origin | Key columns | FKs |
|---|---|---|---|
| `organization` (schema.ts:2064) | upstream | id*, name, siteName, avatar_url, settings, landingpage, theme, created_at, customization, is_restricted, customCode, customDomain, favicon, isCustomDomainVerified, disable_signup, disable_signup_message, disable_email_password, disable_google_auth, parent_organization_id, read_only_until, ai_tutor_settings | parentOrganizationId>table |
| `organizationmember` (schema.ts:1845) | upstream | id*, organization_id, role_id, profile_id, email, verified, created_at | organizationId>organization; profileId>profile; roleId>role |
| `organizationmember_email_notifications` (schema.ts:1894) | upstream | organization_member_id*, new_student, new_submission, grading_result, newsfeed, quiz_assigned, cohort_reminder, session, course_completion, created_at, updated_at | organizationMemberId>organizationmember |
| `role` (schema.ts:2028) | upstream | type, description, id*, updated_at, created_at | - |
| `organization_invite` (schema.ts:1428) | upstream | id*, organization_id, role_id, type, email, token_hash, created_by_profile_id, accepted_by_profile_id, accepted_at, revoked_by_profile_id, revoked_at, expires_at, is_revoked, metadata, created_at, updated_at | organizationId>organization; roleId>role; createdByProfileId>profile; acceptedByProfileId>profile; revokedByProfileId>profile |
| `organization_invite_audit` (schema.ts:1492) | upstream | id*, invite_id, organization_id, event_type, actor_profile_id, target_email, ip_address, user_agent, metadata, created_at | inviteId>organizationInvite; organizationId>organization; actorProfileId>profile |
| `organization_plan` (schema.ts:1758) | upstream | id*, activated_at, org_id, plan_name, is_active, deactivated_at, updated_at, payload, triggered_by, provider, subscription_id | orgId>organization; triggeredBy>organizationmember |
| `organization_contacts` (schema.ts:495) | upstream | id*, created_at, email, phone, name, message, organization_id | organizationId>organization |
| `organization_emaillist` (schema.ts:951) | upstream | id*, created_at, email, organization_id | organizationId>organization |
| `waitinglist` (schema.ts:2047) | upstream | id*, email, created_at | - |
| `currency` (schema.ts:356) | upstream | id*, created_at, name | - |
| `test_tenant` (schema.ts:1753) | upstream | id*, details | - |
| `organization_auth_policy` (schema.ts:2578) | upstream | organization_id*, force_sso, auto_join_sso_domains, break_glass_enabled, default_role_id, role_mapping, created_at, updated_at | organization_id>organization; defaultRoleId>role |
| `organization_sso_config` (schema.ts:2610) | upstream | id*, organization_id, better_auth_provider_id, provider, display_name, domain, is_active, created_by_profile_id, updated_by_profile_id, created_at, updated_at | organization_id>organization; created_by_profile_id>profile; updated_by_profile_id>profile |
| `organization_token_auth` (schema.ts:2644) | upstream | id*, organization_id, signing_secret, is_active, created_by_profile_id, created_at, updated_at | organization_id>organization; created_by_profile_id>profile |
| `organization_api_key` (schema.ts:2670) | upstream | id*, organization_id, created_by_profile_id, type, label, secret_prefix, secret_hash, scopes, last_used_at, expires_at, revoked_at, created_at, updated_at | organization_id>organization; created_by_profile_id>profile |
| `organization_automation_usage` (schema.ts:2705) | upstream | id*, organization_id, organization_api_key_id, type, action, category, credits_consumed, metadata, created_at | organization_id>organization; organization_api_key_id>organizationApiKey |

##### Courses, sections, lessons, assets, tags

| Table | Origin | Key columns | FKs |
|---|---|---|---|
| `course` (schema.ts:640) | upstream + Pearl cols (sequential_unlock) | title, description, overview, id*, created_at, updated_at, group_id, is_template, logo, slug, metadata, cost, currency, banner_image, is_published, sequential_unlock, certificate, compliance, status, type, callout | groupId>group |
| `course_section` (schema.ts:288) | upstream | id*, created_at, updated_at, title, order, course_id | course_id>course |
| `lesson` (schema.ts:975) | upstream + Pearl cols (links, unit_type, is_optional) | note, video_url, slide_url, course_id, id*, created_at, updated_at, title, public, lesson_at, teacher_id, is_complete, call_url, order, is_unlocked, completion_policy, video_watch_threshold, videos, documents, links, section_id, slug, unit_type, is_optional | section_id>courseSection; courseId>course; teacherId>profile |
| `lesson_language` (schema.ts:1797) | upstream | id*, content, lesson_id, locale | lessonId>lesson |
| `lesson_language_history` (schema.ts:1823) | upstream | id*, lesson_language_id, old_content, new_content, timestamp | lessonLanguageId>lessonLanguage |
| `lesson_comment` (schema.ts:522) | upstream | id*, created_at, updated_at, lesson_id, groupmember_id, comment | groupmemberId>groupmember; lessonId>lesson |
| `lesson_completion` (schema.ts:1568) | upstream | id*, created_at, lesson_id, profile_id, is_complete, updated_at | lessonId>lesson; profileId>profile |
| `lesson_video_progress` (schema.ts:1534) | upstream | id*, lesson_id, profile_id, asset_id, duration_seconds, watched_seconds, furthest_seconds, last_position_seconds, is_complete, completed_at, created_at, updated_at | lessonId>lesson; profileId>profile |
| `assets` (schema.ts:1071) | upstream | id*, organization_id, kind, provider, storage_provider, storage_key, hls_manifest_key, hls_audio_key, source_url, mime_type, byte_size, checksum, title, description, thumbnail_url, thumbnail_candidates, duration_seconds, aspect_ratio, is_external, status, metadata, created_by_profile_id, created_at, updated_at | organizationId>organization; createdByProfileId>profile |
| `asset_usages` (schema.ts:1129) | upstream | id*, organization_id, asset_id, target_type, target_id, slot_type, slot_key, position, created_by_profile_id, created_at | organizationId>organization; assetId>asset; createdByProfileId>profile |
| `tag_group` (schema.ts:2289) | upstream | id*, organization_id, name, slug, description, order, created_at, updated_at | organizationId>organization |
| `tag` (schema.ts:2319) | upstream | id*, organization_id, group_id, name, slug, description, color, created_at, updated_at | organizationId>organization; groupId>tagGroup |
| `tag_assignment` (schema.ts:2356) | upstream | id*, tag_id, course_id, created_at | tagId>tag; courseId>course |
| `course_import_draft` (schema.ts:2734) | upstream | id*, organization_id, created_by_profile_id, source_type, status, title, locale, idempotency_key, summary, draft, warnings, sourceArtifacts, published_course_id, created_at, updated_at | organization_id>organization; created_by_profile_id>profile; published_course_id>course |
| `course_invite` (schema.ts:1326) | upstream | id*, course_id, role_id, token_hash, created_by_profile_id, revoked_by_profile_id, revoked_at, expires_at, max_uses, used_count, is_revoked, allowed_emails, allowed_domains, metadata, created_at, updated_at, last_used_at | courseId>course; createdByProfileId>profile; revokedByProfileId>profile; roleId>role |
| `course_invite_audit` (schema.ts:1386) | upstream | id*, invite_id, course_id, event_type, actor_profile_id, target_email, ip_address, user_agent, metadata, created_at | inviteId>courseInvite; courseId>course; actorProfileId>profile |
| `video_transcripts` (schema.ts:935) | upstream | id*, created_at, muse_svid, transcript, downloaded, link | - |
| `media_job` (schema.ts:3679) | upstream | id*, organization_id, asset_id, status, stage, progress_percent, attempt, max_attempts, cancel_requested_at, result, error, warnings, created_at, updated_at | organizationId>organization; assetId>asset; triggeredByProfileId>profile |
| `job_step` (schema.ts:3739) | upstream | id*, status, result, error, attempt, started_at, finished_at, created_at, updated_at | - |
| `media_transcript` (schema.ts:3775) | upstream | id*, organization_id, asset_id, media_job_id, language, provider, model, text, segments, vtt_storage_key, vtt_bucket, duration_seconds, cost_cents, created_at, updated_at | organizationId>organization; assetId>asset; mediaJobId>mediaJob |
| `dead_letter_job` (schema.ts:3829) | upstream | id*, organization_id, domain, run_id, queue_name, job_name, payload, error, attempts, created_at | - |
| `course_newsfeed` (schema.ts:1683) | upstream | created_at, author_id, content, id*, course_id, reaction, is_pinned | authorId>groupmember; courseId>course |
| `course_newsfeed_comment` (schema.ts:1710) | upstream | created_at, author_id, content, id*, course_newsfeed_id, parent_id, reply_to_comment_id | authorId>groupmember; courseNewsfeedId>courseNewsfeed; parentId>table; replyToCommentId>table |

##### Groups / enrolment (course roster)

| Table | Origin | Key columns | FKs |
|---|---|---|---|
| `group` (schema.ts:301) | upstream | id*, name, description, created_at, updated_at, organization_id | organizationId>organization |
| `groupmember` (schema.ts:1287) | upstream | id*, group_id, role_id, profile_id, email, created_at, assigned_student_id, certificate_earned_at, certification_email_sent_at | groupId>group; profileId>profile; roleId>role |
| `group_attendance` (schema.ts:324) | upstream | id*, created_at, updated_at, course_id, student_id, is_present, lesson_id | courseId>course; studentId>groupmember |

##### Exercises, questions, legacy submissions, quizzes, polls

| Table | Origin | Key columns | FKs |
|---|---|---|---|
| `exercise` (schema.ts:1217) | upstream | title, description, lesson_id, course_id, section_id, order, created_at, updated_at, id*, is_unlocked, due_by, allow_multiple_attempts, section_display_mode, completion_policy, pass_threshold, slug | lessonId>lesson; courseId>course; sectionId>courseSection |
| `exercise_section` (schema.ts:1261) | upstream | id*, exercise_id, title, description, order, color_theme, after_behavior, created_at, updated_at | exerciseId>exercise |
| `exercise_template` (schema.ts:2532) | upstream | id*, created_at, title, description, tag, questionnaire | - |
| `question` (schema.ts:1918) | upstream | id*, question_type_id, title, created_at, updated_at, exercise_id, exercise_section_id, name, points, settings, order | exerciseId>exercise; exerciseSectionId>exerciseSection; questionTypeId>questionType |
| `question_type` (schema.ts:2009) | upstream | id*, label, created_at, updated_at, typename | - |
| `option` (schema.ts:432) | upstream | id*, label, is_correct, settings, question_id, value, created_at, updated_at | questionId>question |
| `question_answer` (schema.ts:1961) | upstream | id*, answer_data, question_id, group_member_id, submission_id, point | groupMemberId>groupmember; questionId>question; submissionId>submission |
| `submission` (schema.ts:577) | upstream | id*, reviewer_id, status_id, grading_state, overall_status, total, created_at, updated_at, exercise_id, submitted_by, course_id, feedback | courseId>course; exerciseId>exercise; statusId>submissionstatus; submittedBy>groupmember |
| `submissionstatus` (schema.ts:623) | upstream | id*, label, updated_at | - |
| `quiz` (schema.ts:553) | upstream | id*, created_at, updated_at, title, questions, timelimit, theme, organization_id | organizationId>organization |
| `quiz_play` (schema.ts:461) | upstream | id*, created_at, updated_at, quiz_id, players, started, currentQuestionId, showCurrentQuestionAnswer, isLastQuestion, step, studentStep, pin | quizId>quiz |
| `apps_poll` (schema.ts:908) | upstream | id*, created_at, updated_at, question, authorId, isPublic, status, expiration, courseId | authorId>groupmember; courseId>course |
| `apps_poll_option` (schema.ts:369) | upstream | id*, created_at, updated_at, poll_id, label | pollId>appsPoll |
| `apps_poll_submission` (schema.ts:1181) | upstream | id*, created_at, poll_option_id, selected_by_id, poll_id | pollId>appsPoll; pollOptionId>appsPollOption; selectedById>groupmember |

##### Coursework, results, progress, completion (PearlLMS core loop)

| Table | Origin | Key columns | FKs |
|---|---|---|---|
| `coursework_submission` (schema.ts:3998) | **PearlLMS** | id*, learner_id, course_id, lesson_id, assessment_key, submission_type, version, files, comment, status, submitted_at | learnerId>profile; courseId>course; lessonId>lesson |
| `coursework_result` (schema.ts:4048) | **PearlLMS** | id*, submission_id, kind, result, feedback, feedback_files, recorded_by, recorded_at | submissionId>courseworkSubmission; recordedBy>profile |
| `unit_time_spent` (schema.ts:4087) | **PearlLMS** | id*, learner_id, course_id, lesson_id, seconds, updated_at | learnerId>profile; courseId>course; lessonId>lesson |
| `unit_time_monthly` (schema.ts:4123) | **PearlLMS** | id*, learner_id, course_id, year_month, seconds, updated_at | learnerId>profile; courseId>course |
| `course_completion` (schema.ts:4156) | **PearlLMS** | id*, learner_id, course_id, completed_at, created_at | learnerId>profile; courseId>course |
| `id_verification` (schema.ts:4466) | **PearlLMS** | id*, learner_id, status, method, verified_by, verified_at, note, updated_at | learnerId>profile; verifiedBy>profile |
| `tutor_feedback` (schema.ts:4386) | **PearlLMS** | id*, organization_id, learner_id, tutor_id, tutor_name, milestone, overall_rating, communication_rating, helpfulness_rating, knowledge_rating, comment, created_at | organizationId>organization; learnerId>profile; tutorId>profile |
| `course_completion_record` (schema.ts:787) | upstream | id*, course_id, group_member_id, profile_id, cycle_number, status, due_date, started_at, completed_at, valid_until, expired_at, score, attempts, time_spent_minutes, waived_by, waiver_reason, waiver_expires_at, created_at, updated_at | courseId>course; groupMemberId>groupmember; profileId>profile; waivedBy>profile |
| `course_completion_notification_event` (schema.ts:843) | upstream | id*, course_completion_record_id, channel, event_type, sent_at | courseCompletionRecordId>courseCompletionRecord |
| `course_certificate_issue` (schema.ts:869) | upstream | id*, course_id, profile_id, course_completion_record_id, cycle_number, issued_at, expires_at, status, file_url | courseId>course; profileId>profile; courseCompletionRecordId>courseCompletionRecord |

##### Allocation (tutor to learner)

| Table | Origin | Key columns | FKs |
|---|---|---|---|
| `tutor_allocation` (schema.ts:3951) | **PearlLMS** | id*, organization_id, tutor_id, learner_id, created_by, created_at | organizationId>organization; tutorId>profile; learnerId>profile; createdBy>profile |

##### Cohorts (and legacy programs)

| Table | Origin | Key columns | FKs |
|---|---|---|---|
| `cohort` (schema.ts:3052) | upstream | id*, created_at, updated_at, organization_id, name, description, cover_image, status, created_by_profile_id | organizationId>organization; createdByProfileId>profile |
| `cohort_course` (schema.ts:3083) | upstream | id*, cohort_id, course_id, added_at | cohortId>cohort; courseId>course |
| `cohort_member` (schema.ts:3110) | upstream | id*, cohort_id, profile_id, role_id, email, created_at | cohortId>cohort; profileId>profile; roleId>role |
| `cohort_newsfeed` (schema.ts:3145) | upstream | id*, created_at, author_id, cohort_id, content, reaction, is_pinned | authorId>cohortMember; cohortId>cohort |
| `cohort_newsfeed_comment` (schema.ts:3173) | upstream | id*, created_at, author_id, content, cohort_newsfeed_id | authorId>cohortMember; cohortNewsfeedId>cohortNewsfeed |
| `cohort_goal` (schema.ts:3222) | upstream | id*, cohort_id, title, description, type, course_ids, required_count, score_threshold, team_pass_rate_threshold, deadline_kind, deadline_date, relative_days, recurring_months, reminder_days_before, status, created_by_profile_id, created_at, updated_at | cohortId>cohort; createdByProfileId>profile |
| `cohort_goal_assignment` (schema.ts:3263) | upstream | id*, goal_id, cohort_member_id, due_date, status, completed_count, required_count, completed_at, last_evaluated_at, created_at, updated_at | goalId>cohortGoal; cohortMemberId>cohortMember |
| `program` (schema.ts:2777) | upstream | id*, created_at, updated_at, organization_id, name, description, cover_image, status, created_by_profile_id | organizationId>organization; createdByProfileId>profile |
| `program_course` (schema.ts:2808) | upstream | id*, program_id, course_id, added_at | programId>program; courseId>course |
| `program_member` (schema.ts:2835) | upstream | id*, program_id, profile_id, role_id, email, created_at | programId>program; profileId>profile; roleId>role |
| `program_newsfeed` (schema.ts:2870) | upstream | id*, created_at, author_id, program_id, content, reaction, is_pinned | authorId>programMember; programId>program |
| `program_newsfeed_comment` (schema.ts:2898) | upstream | id*, created_at, author_id, content, program_newsfeed_id | authorId>programMember; programNewsfeedId>programNewsfeed |
| `program_goal` (schema.ts:2960) | upstream | id*, program_id, title, description, type, deadline_kind, status, created_by_profile_id, created_at, updated_at | programId>program; createdByProfileId>profile |
| `program_goal_assignment` (schema.ts:3009) | upstream | id*, goal_id, program_member_id, status, completed_at, last_evaluated_at, created_at, updated_at | goalId>programGoal; programMemberId>programMember |

##### Comms: notifications, messages, announcements, registrations

| Table | Origin | Key columns | FKs |
|---|---|---|---|
| `notification` (schema.ts:4186) | **PearlLMS** | id*, user_id, type, entity_type, entity_id, created_at, read_at | userId>profile |
| `notification_preference` (schema.ts:4212) | **PearlLMS** | id*, user_id, category, email_enabled, created_at, updated_at | userId>profile |
| `message_thread` (schema.ts:4238) | **PearlLMS** | id*, organization_id, tutor_id, learner_id, archived_at, created_at | organizationId>organization; tutorId>profile; learnerId>profile |
| `message` (schema.ts:4272) | **PearlLMS** | id*, thread_id, sender_id, body, created_at | threadId>messageThread; senderId>profile |
| `message_read` (schema.ts:4299) | **PearlLMS** | id*, thread_id, profile_id, last_read_at | threadId>messageThread; profileId>profile |
| `announcement` (schema.ts:4336) | **PearlLMS** | id*, organization_id, author_id, course_id, audience_type, target_user_id, title, body, published_at, created_at, archived_at, deleted_at | organizationId>organization; authorId>profile; courseId>course; targetUserId>profile |
| `registration` (schema.ts:4428) | **PearlLMS** | id*, organization_id, full_name, email, requested_course_id, status, decision_note, decided_by, decided_at, created_at | organizationId>organization; requestedCourseId>course; decidedBy>profile |

##### Audit & system logs

| Table | Origin | Key columns | FKs |
|---|---|---|---|
| `audit_event` (schema.ts:3860) | **PearlLMS** | id*, occurred_at, actor_user_id, organization_id, action, entity_type, entity_id, metadata | - |
| `system_event_log` (schema.ts:3884) | **PearlLMS** | id*, occurred_at, event_type, severity, user_id, user_email, ip_masked, path, method, http_status, message, stack, organization_id, correlation_id, metadata | - |

##### Community

| Table | Origin | Key columns | FKs |
|---|---|---|---|
| `community_question` (schema.ts:1636) | upstream | id*, created_at, title, body, author_id, votes, organization_id, slug, author_profile_id, course_id | authorId>organizationmember; authorProfileId>profile; courseId>course; organizationId>organization |
| `community_answer` (schema.ts:1600) | upstream | id*, created_at, question_id, body, author_id, votes, author_profile_id | authorId>organizationmember; authorProfileId>profile; questionId>communityQuestion |

##### Analytics

| Table | Origin | Key columns | FKs |
|---|---|---|---|
| `analytics_login_events` (schema.ts:170) | upstream | id*, user_id, logged_in_at, logged_in_date | userId>user |
| `analytics_page_event` (schema.ts:202) | upstream | id*, occurred_at, org_id, session_id, user_id, event_type, course_id, path, referrer_host, utm_source, utm_medium, utm_campaign, country, device_type, locale, props | - |
| `analytics_org_daily` (schema.ts:231) | upstream | id*, org_id, date, landing_views, unique_visitors, course_page_views, enrollments, completions, updated_at | - |
| `analytics_course_daily` (schema.ts:250) | upstream | id*, course_id, org_id, date, views, unique_visitors, enrollments, completions, avg_time_to_enroll_seconds, updated_at | - |
| `analytics_country_daily` (schema.ts:271) | upstream | id*, org_id, date, country, views, enrollments, updated_at | - |

##### AI (chat, agent runs, credits, tutor caps)

| Table | Origin | Key columns | FKs |
|---|---|---|---|
| `ai_token_usage` (schema.ts:3301) | upstream | id*, org_id, user_id, course_id, prompt_tokens, completion_tokens, cost_units, model, created_at | orgId>organization |
| `ai_credit_balance` (schema.ts:3332) | upstream | id*, org_id, balance, updated_at | orgId>organization |
| `ai_credit_purchase` (schema.ts:3356) | upstream | id*, org_id, triggered_by, provider, provider_order_id, tokens, quantity, unit_price_cents, currency, payload, created_at | orgId>organization; triggeredBy>profile |
| `ai_tutor_message_count` (schema.ts:3395) | upstream | id*, org_id, user_id, message_count, last_message_at, cap_hit_at, created_at, updated_at | orgId>organization; userId>profile |
| `ai_tutor_cap_event` (schema.ts:3432) | upstream | id*, org_id, user_id, course_id, occurred_at | orgId>organization; userId>profile |
| `ai_chat_conversation` (schema.ts:3465) | upstream | id*, course_id, user_id, title, messages, created_at, updated_at | courseId>course |
| `ai_chat_model_context` (schema.ts:3488) | upstream | conversation_id*, course_id, user_id, model_summary, compacted_through_message_id, source_ids, created_at, updated_at | conversationId>aiChatConversation; courseId>course; userId>profile |
| `ai_chat_document` (schema.ts:3520) | upstream | id*, conversation_id, course_id, user_id, asset_id, file_name, mime_type, text, word_count, page_count, created_at | conversationId>aiChatConversation |
| `ai_agent_run` (schema.ts:3545) | upstream | id*, org_id, course_id, conversation_id, user_id, status, phase, progress_percent, current_step_key, approved_plan, execution_cursor, source_ids, model_summary, queued_instructions, last_error, attempt, max_attempts, worker_id, locked_at, cancel_requested_at, started_at, finished_at, created_at, updated_at | orgId>organization; courseId>course; conversationId>aiChatConversation; userId>profile |
| `ai_agent_run_step` (schema.ts:3607) | upstream | id*, run_id, step_key, step_type, status, input_hash, input, output, output_ids, idempotency_key, error, attempt, started_at, finished_at, created_at, updated_at | runId>aiAgentRun |
| `ai_agent_run_event` (schema.ts:3641) | upstream | id*, run_id, event_type, message, payload, created_at | runId>aiAgentRun |

##### Widgets (embeds)

| Table | Origin | Key columns | FKs |
|---|---|---|---|
| `widget` (schema.ts:2386) | upstream | id*, organization_id, name, status, layout_type, selection_mode, public_key, config, has_unpublished_changes, latest_published_version_id, created_by_user_id, updated_by_user_id, deleted_at, created_at, updated_at | organizationId>organization; createdByUserId>user; updatedByUserId>user |
| `widget_course` (schema.ts:2436) | upstream | id*, widget_id, course_id, order, created_at | widgetId>widget; courseId>course |
| `widget_version` (schema.ts:2467) | upstream | id*, widget_id, version, config_snapshot, payload_snapshot, runtime_manifest, rolled_back_from_version_id, published_by_user_id, published_at | widgetId>widget; publishedByUserId>user; rolledBackFromVersionId>table |

#### 3.3 Enums (27 `pgEnum`, schema.ts:27-74 and inline)
`COURSE_TYPE, LOCALE (en hi fr pt de vi ru es pl da), PLAN (EARLY_ADOPTER ENTERPRISE BASIC), member_status (ACTIVE DEACTIVATED, Pearl), COURSE_IMPORT_SOURCE_TYPE, COURSE_IMPORT_DRAFT_STATUS, ORGANIZATION_API_KEY_TYPE (mcp api zapier), AUTOMATION_USAGE_CATEGORY, AI_AGENT_RUN_STATUS, WIDGET_STATUS, WIDGET_LAYOUT_TYPE, WIDGET_SELECTION_MODE, COURSE_INVITE_EVENT_TYPE, ORGANIZATION_INVITE_EVENT_TYPE, ORGANIZATION_INVITE_TYPE (EMAIL LINK), SSO_PROVIDER, PROGRAM_STATUS, PROGRAM_GOAL_TYPE/DEADLINE_KIND/STATUS/ASSIGNMENT_STATUS, COHORT_STATUS, COHORT_GOAL_TYPE/DEADLINE_KIND/STATUS/ASSIGNMENT_STATUS, JOB_STATUS`. Pearl-owned value sets (result values, unit types, notification categories, id-verification statuses, registration statuses) are NOT Postgres enums - they are varchar columns validated from `packages/utils/src/constants/*`.

#### 3.4 How the schema is created on a fresh DB
- Tooling: Drizzle ORM + drizzle-kit. `packages/db/drizzle.config.ts` (schema `./src/schema.ts`, out `./src/migrations`, url = `DIRECT_DATABASE_URL` else `DATABASE_URL`, SSL required unless `DATABASE_SSL=disable`).
- **27 migrations**, `packages/db/src/migrations/0000_...` to `0026_clever_arachne.sql` + `meta/_journal.json` (27 entries) + 27 snapshots. `0000_shocking_carmella_unuscione.sql` creates the whole upstream schema (~90 tables, 161 ALTERs for FKs); `0001` asset_usages unique; `0002` cohorts; `0003` profile.settings; `0004` member email-notification prefs; `0005` newsfeed comment parent; `0006` member_status enum + profile.status; `0007` audit_event; `0008` learner_profile; `0009` lesson.unit_type; `0010` lesson.links; `0011` tutor_allocation + coursework_submission/result; `0012` course.sequential_unlock; `0013` course_completion; `0014` notification(+preference); `0015` messaging; `0016` announcement; `0017` registration; `0018` id_verification; `0019` assessment_key/kind columns + new unique; `0020/0021` unit time tables; `0022` feedback_files + comment; `0023` lesson.is_optional; `0024` announcement audience columns + one data UPDATE backfill; `0025` tutor_feedback; `0026` system_event_log. No migration inserts reference data, creates extensions, RLS or policies.
- **Fresh-DB command**: `pnpm --filter @cio/db db:setup` (`packages/db/src/scripts/db-setup.ts`; run automatically by `docker/entrypoint-api.sh` on every API container start unless `SKIP_DB_SETUP=true`). Sequence: connect on `DIRECT_DATABASE_URL`; `CREATE ROLE authenticated` / `anon` if missing (Supabase already has them); take advisory lock `4242424242`; `baselineMigrationsIfNeeded` (only adopts a pre-existing populated DB into the drizzle journal - no-op on empty); `drizzle-kit migrate`; then essential seed `seed --roles --submissions --question-types`. `--seed` additionally loads demo orgs/users/courses (fixed UUIDs, `packages/db/users.json`) - **do not use in production**.
- Other scripts (`packages/db/package.json`): `db:baseline`, `db:reset`, `db:generate`, `db:studio`, `seed:fixtures` (4 fake users per role, password `FixturePass!2026`, dev only), `set-password.ts` (reset an EXISTING user's password via SET_PW_EMAIL/SET_PW_PASSWORD), `db:login-link`, `db:push-dump-to-new-db`, `db:dump-backup`, `supabase-to-betterauth` (legacy import), plus backfills (not needed for a new tenant).
- Connection model: runtime `DATABASE_URL` = Supabase transaction pooler (6543; client uses `prepare:false`, `ssl:'require'`, pool `DATABASE_POOL_MAX` default 10). Migrations/DDL = `DIRECT_DATABASE_URL` (5432; use the **session pooler** URL if your host is IPv4-only - the direct host is IPv6). Pooler host prefix can be `aws-1-` (not `aws-0-`) - verify in the Connect dialog.
- Sizing check from prod: 119 public tables after full setup (BASELINE.md said 101 at Phase 0).

#### 3.5 Required seed rows (inserted by `db:setup`)
- `role`: `1 ADMIN`, `2 TUTOR`, `3 STUDENT`, `4 MANAGER` (`packages/db/src/utils/seed/role.ts`). Hard-coded everywhere via `ROLE` constants.
- `submissionstatus`: labels `Submitted`, `In Progress`, `Graded`.
- `question_type`: 14 rows (RADIO, CHECKBOX, TEXTAREA, TRUE_FALSE, SHORT_ANSWER, NUMERIC, FILL_BLANK, ...; `utils/seed/questionType.ts`).
- Not seeded and not required: `currency`, `exercise_template` (seed-only demo), `organization*`.

#### 3.6 Extensions, RLS, buckets, manual SQL
- **Extensions: none required.** `gen_random_uuid()` is core (PG13+, project is PG17). Prod only has Supabase defaults installed (`pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `supabase_vault`, `plpgsql`); `moddatetime` is available but unused by the repo.
- **RLS/policies: not in the repo** (0 `pgPolicy`, 0 `ENABLE ROW LEVEL SECURITY` in schema or migrations). Prod has RLS enabled on all 119 public tables (checked read-only via `pg_tables.rowsecurity`); policy count could not be queried (a second read query was denied by the permission layer). Recommended for the new project: run `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on every public table (or enable Supabase "auto-enable RLS on new tables" before migrating) and add no policies - the API connects as `postgres` owner so it bypasses RLS, while PostgREST/anon/authenticated get nothing. Do this as a post-migration SQL step; it is the only manual SQL.
- **Storage buckets (manual, Supabase dashboard/MCP):** `documents` (private), `videos` (private), `media` (public read). Create S3 access keys; env `OBJECT_STORAGE_*` (endpoint `https://<ref>.storage.supabase.co/storage/v1/s3`, `FORCE_PATH_STYLE=true`, region). Server-proxied uploads >512KB need `DASHBOARD_BODY_SIZE_LIMIT` on the dashboard (adapter-node).
- Redis is required (BullMQ + rate limit + presign cache): `REDIS_URL` has no default.

#### 3.7 Creating the FIRST admin + organization on an EMPTY database (what the code actually allows)
State of the code: `disableSignUp:true`; `signupGuard` additionally 400s (`ORG_CONTEXT_REQUIRED`) without a `cio-org-id`; `POST /onboarding/create-org` and `POST /organization` (`createOrganizationWithOwner`, `apps/api/src/services/onboarding.ts`) require a logged-in user and refuse a 2nd org when `PUBLIC_IS_SELFHOSTED=true`. The old "first signup auto-verifies and creates the org" flow (`create-profile.ts` `isSelfHostedFirstSignup`, BASELINE walkthrough) is therefore unreachable. Prod was bootstrapped while still on the Phase-0 build (sign-up open). **Nothing in the repo seeds the owner.** Options for Gecko:

1. **Write a one-off bootstrap script** (recommended; model it on `packages/db/src/scripts/seed-fixtures.ts` + `createOrganizationWithOwner` + `createOrgUser`). Rows, in order (all in one transaction):
   - `user`: `id` uuid, `name`, `email` (lowercase), `email_verified=true`, `banned=false`, `role=null` (Better Auth admin plugin role is unused for authz).
   - `account`: `provider_id='credential'`, `account_id=<user.id>`, `user_id`, `password` = **bcrypt cost 10** hash (Better Auth is configured with bcrypt; see `auth/email-password.ts`).
   - `profile`: `id=<user.id>` (FK to user), `fullname`, unique `username`, `email`, `status='ACTIVE'`, `is_email_verified=true`, `verified_at=now()`, `settings={"mustChangePassword":true}` optional.
   - `organization`: `name`, unique `site_name` (`siteName`, becomes the tenant slug used in dashboard URLs `/org/<siteName>`), defaults for the rest (`customization`, `is_restricted`, `ai_tutor_settings` have defaults). Optionally `avatar_url`, `theme`, `favicon` for branding.
   - `organizationmember`: `organization_id`, `role_id=1`, `profile_id`, `email`, `verified=true`. **This row's id fixes the super admin forever** (lowest admin member id).
   - `organization_plan`: `org_id`, `plan_name='ENTERPRISE'`, `is_active=true`, `provider='selfhosted'`, `subscription_id='selfhosted-<orgId>'`, `triggered_by=<member.id>`, `payload={}` (gates AI/paid features; `isOrgOnPaidPlan`).
   - Everything else (more admins/tutors/learners/managers) is then created in-app by the super admin (`POST /organization/management/{admins,tutors,learners}` returns a one-time temp password; `mustChangePassword` flag forces change on first login).
   Alternatively call `auth.api.createUser({body:{email,name,password,role:'user'}})` from the script (headerless server call, exactly what `createOrgUser` does) then insert `profile` (the `user.create.after` hook `createProfileHook` auto-creates a profile with username `<emailprefix><timestamp>`, so UPDATE it rather than inserting) and the org rows above. Use `set-password.ts` later to recover a login.
2. Temporarily build/run with sign-up enabled (set `disableSignUp:false`, `PUBLIC_IS_SELFHOSTED=true`, call `/api/auth/sign-up/email`, then `POST /onboarding/create-org`) - works only with a code change; not recommended.
3. Self-hosted flag off (cloud mode) allows multiple orgs but turns on cloud-only paths (v1 API, SSO plugins, Polar billing) - not tested by Pearl.

Org-less-user behaviour to remember: with self-hosted on, a provisioned user without a membership is auto-enrolled into the first org as STUDENT (`services/account/profile.ts`).

---

### 4. Jobs (`apps/jobs`, `packages/jobs`)

Engine: **BullMQ on Redis**. `packages/jobs/src/connection.ts` `createRedisConnection()` requires `REDIS_URL` (throws if unset). Queue names/job names: `packages/jobs/src/queues/names.ts`; per-queue retry defaults: `queues/defaults.ts`; typed payloads (zod): `payloads/*`; producers: `packages/jobs/src/enqueue/*` (called from `apps/api/src/services/jobs`). Worker process: `apps/jobs/src/index.ts` imports all six workers (prod can scale one with `start:<worker>`); ffmpeg/ffprobe must be on PATH for media workers. Exhausted jobs write `dead_letter_job` rows. `/admin/queues` UI for inspection.

| Queue | Worker file | Jobs | Trigger | Retries (attempts/backoff) | External |
|---|---|---|---|---|---|
| `emails` | `workers/emails.ts` -> `processors/emails` | `send` | API `enqueueTransactionalEmail/enqueueRawEmail` (invites, welcomes, notifications pipeline, `POST /mail`) | 5 / exp 5s | SMTP or ZeptoMail |
| `notifications` | `workers/notifications.ts` | `notify-course-exercise` (quizAssigned emails), `notify-course-session-update` (sessionUpdated, with ICS), `session-reminder-scan` | API on exercise notify / session edit; **repeatable scheduler `session-reminder-scan-scheduler` every 15 min** (also `POST /internal/compliance/send-session-reminders`) | 3 / exp 5s | SMTP |
| `maintenance` | `workers/maintenance.ts` (concurrency 1) | `media-job-reap`, `analytics-daily-rollup`, `system-event-purge`, `dead-letter-cleanup`, `asset-storage-cleanup`, `retention-compact` (no-op stub) | **Schedulers on boot (idempotent upsert): media-job-reap every 5 min; analytics-daily-rollup every 24h; system-event-purge every 24h (deletes `system_event_log` older than 90 days)**. `asset-storage-cleanup` enqueued on asset delete; dead-letter-cleanup has no scheduler | 2 / exp 60s | S3 storage, DB |
| `media` | `workers/media.ts` | `probe-metadata`, `generate-thumbnail`, `extract-audio`, `compress-video` | API on asset upload / `/jobs/media/asset/:id` regen | 3 / exp 30s | ffmpeg + S3. **Known bug**: `ffmpegProbeLuma` imported but not exported (`apps/jobs/src/utils/ffmpeg.ts`) - verify before relying on thumbnails |
| `media-transcribe` | `workers/media-transcribe.ts` | `transcribe-audio` | after extract-audio / manual | 4 / exp 60s | OpenAI Whisper (`OPENAI_API_KEY`) |
| `agent-course-generation` | `workers/agent-course-generation.ts` | `run` | `/agent/runs` create/resume/retry | 3 / exp 60s | LLM providers |
| `webhooks`, `course-imports`, `onboarding-bootstrap` | **no worker, no producer (dead)** | - | - | - | slated for removal (HARDENING SW-22) |

Cron-style HTTP triggers (no scheduler in repo - must be hit by external cron with `Authorization: Bearer $PRIVATE_SERVER_KEY`, `POST`): `/internal/compliance/{send-session-reminders,check-expiry,send-reminders,evaluate-cohort-goals,send-cohort-goal-reminders}`, `/internal/analytics/rollup-daily`, `/internal/account/workspace-grace`. Of these, session reminders and analytics rollup are already covered by the BullMQ schedulers; compliance expiry/reminders and cohort-goal sweeps are upstream compliance features that only run if cron'd (PRD suggests daily 02:00/02:30). Pearl's own flows (coursework, comms) are event-driven only.

---

### 5. Emails (`packages/email`)

Transport (`src/send.ts` `deliverEmail`): `ZOHO_TOKEN` set => ZeptoMail HTTP API (`utils/services/zeptomail.ts`), else **nodemailer SMTP** (`utils/services/nodemailer.ts`): env `SMTP_HOST`, `SMTP_PORT` (465 = implicit TLS; otherwise STARTTLS enforced), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SENDER` (From, full `"Name" <addr>`), `SMTP_REPLY_TO`, dev-only `SMTP_ALLOW_INSECURE=true` (Mailpit). Auth emails (reset/verify) are sent by the API process directly via `sendEmail`; everything else goes through the `emails` queue so both API and jobs need the SMTP env. If SMTP is unconfigured the transporter returns `success:false` (prod is held on AWS SES decision D32). `COURSEWORK_EMAILS_ENABLED=false` disables the two coursework emails.

Shared layout: `src/templates/default.ts` `getDefaultTemplate(content, branding)` - HTML shell with masthead (org logo+name if `branding.logoUrl/orgName`, else hard-coded `CLASSROOMIO_LOGO = https://brand.cdn.clsrio.com/cio-bg-transparent.png` linking `https://classroomio.com`, alt "Integer Training LMS"), button color = sanitized org `themeColor` (default `#1D4EE2`; `core/branding.ts` maps org `theme` names to hex), footer "Integer Training LMS {year}. All rights reserved." with links to classroomio.com website/tos/privacy. Sender fallbacks (`utils/constants.ts`): `"Best from Integer Training LMS" <notify@mail.classroomio.com>` / reply `help@classroomio.com`. Other hard-coded brand strings: `ics.ts` PRODID `-//ClassroomIO//Live Session//EN`; `packages/db/src/auth/email-verification.ts:53` From display `"${org.name} (via ClassroomIO.com)"` and org-name fallback `'ClassroomIO'`; `apps/api/src/services/organization/invite.ts` ~271-272 same suffix + subject "on ClassroomIO". Rebrand checklist: `docs/TODO-BRANDING.md` (partly stale: much was changed to "Integer Training LMS" already).

| Email id (file in `src/emails/`) | Subject | Trigger (producer) | Recipient | Brand strings in body |
|---|---|---|---|---|
| `forgotPassword` (forgot-password.ts) | "Password reset notification - Integer Training LMS" | Better Auth `sendResetPassword` (`packages/db/src/auth/email-password.ts`; also used as the staff set-password invite) | the user | "your Integer Training LMS account"; support `help@classroomio.com` |
| `onPasswordReset` | "Password Reset Successful - Integer Training LMS" | Better Auth `onPasswordReset` | the user | subject only |
| `verifyEmail` | "Action Required: Confirm your email" | `packages/db/src/auth/email-verification.ts` (only when `trigger=app`) | the user | From "(via ClassroomIO.com)" |
| `welcome` | "Welcome to Integer Training LMS!" | `POST /onboarding/complete` (`services/onboarding.ts`) | new owner | "My name is Best, the founder of Integer Training LMS", classroomio.com/demo link |
| `inviteTeacher` | "You have been invited to join an organization on Integer Training LMS" | `services/organization/invite.ts` (team invite) | invitee | "on Integer Training LMS" |
| `studentOrgInvite` | "You have been invited to join as a student" | `services/organization/audience.ts` (invite/resend) | learner | org branding |
| `studentCourseInvite` | "You are invited to join a course" | `services/course/invite.ts` | learner | - |
| `studentCourseWelcome` | "You have access to {course} course" | enrolment (`course/invite.ts`, `course/people.ts`, `organization/audience.ts`) | learner | org name (escaped) |
| `studentCohortWelcome` | "You have access to a cohort - sign in to get started" | `organization/audience.ts` | learner | - |
| `teacherCourseWelcome` | "You have been invited to a course!" | `course/people.ts` | tutor | - |
| `teacherStudentJoined` | "You've got a new student" | `course/invite.ts`, `course/people.ts` | course team | - |
| `teacherStudentBuyRequest` | "Request to Join Course!" | `course/payment-request.ts` | teacher | - |
| `studentProvePayment` | "One more step left" | `course/payment-request.ts` | learner | - |
| `studentCourseCompletion` | "Congratulations - you completed the course requirements" | `utils/course-completion.ts` | learner | custom message escaped |
| `newsfeedPost` / `newsfeedComment` | "New post in course" / "News feed comment" | `services/newsfeed/newsfeed.ts` | course members / thread | escaped user text |
| `quizAssigned` | "You have a quiz to complete" | `jobs notify-course-exercise` | enrolled learners | - |
| `sessionReminder` / `sessionUpdated` | "Reminder: your live session is coming up" / "Updated: your live session details changed" | `session-reminder-scan` (15 min) / `notify-session-update` (ICS attached) | enrolled learners | ICS PRODID ClassroomIO |
| `submissionReceived` / `submissionGraded` | "New exercise submission" / "Your exercise submission has been updated" | `services/submission/submission.ts` (legacy exercise stack) | teacher / learner | - |
| `studentLimitReached` / `studentLimitApproaching` | Free-plan limit messages | `services/organization/student-limit.ts`, script | org admin | "Free plan" (cloud-plan copy; irrelevant on self-hosted) |
| `cohortGoalReminder` | "Reminder: a cohort goal is due soon" | `services/cohort/goal.ts` | cohort member | - |
| `courseworkSubmitted` | "New coursework submitted by one of your learners" | `services/coursework/notifications.ts` via `emitNotification` (Phase 3) | learner's ALLOCATED tutor(s) | content-light, no PII |
| `courseworkResulted` | "Feedback is available on your coursework" | same | the learner | content-light |
| `messageReceived` | "You have a new message" | `services/comms/messaging.ts` | other thread participant (if pref on) | content-light |
| `announcementPublished` | "New announcement" | `services/comms/announcements.ts` | audience (if pref on) | content-light |
| `registrationSubmitted` | "New learner registration" | `services/registration/registration.ts` | all Managers + Admins | content-light |

Pearl notification pipeline (`emitNotification`): always an in-app `notification` row; email only if `notification_preference.email_enabled` (category default from config). Emails are content-light by design (no message bodies/results).

---

### 6. Other packages

| Package | What it does | External service / config |
|---|---|---|
| `packages/core` (`@cio/core`) | shared env zod schema (`config/env.ts`), S3 storage client + presign (`config/storage.ts`, `utils/s3.ts`), Redis utils, agent services, tinybird, org/course services | S3-compatible storage (`OBJECT_STORAGE_*`, falls back to Cloudflare R2 `CLOUDFLARE_*`, throws if neither), Redis, optional Tinybird (`TINYBIRD_TOKEN`), Jina reader `r.jina.ai` (`JINA_API_KEY`) |
| `packages/certificates` | pure HTML/CSS certificate renderers: templates classique, brutalist, noir, poster, minimal (`render.ts`, `templates/*`) | PDF/PNG rendered by the API through **Cloudflare Browser Rendering** (`apps/api/src/utils/cloudflare.ts`, `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_RENDERING_API_KEY`); Tailwind CDN + Google Fonts inside HTML. Certificates are out of scope for Pearl (keys unset) but routes `/course/:id/download/certificate*` exist |
| `packages/ai-assistant` | Vercel AI SDK (`ai` v6) provider layer + prompts + tools (teacher/student), tutor-config | Providers: OpenAI (`gpt-5.4-mini`), Anthropic (`claude-sonnet-4-20250514`), Google (`gemini-3.1-flash-lite`), Moonshot (`kimi-k2.6`); keys via env `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `MOONSHOT_API_KEY`. `pickAnyConfiguredProvider` order Google, OpenAI, Anthropic. **No key set => AI endpoints 503**; paid-plan gate uses `organization_plan` (ENTERPRISE auto on self-hosted). Credits tracked in `ai_credit_balance/ai_token_usage` |
| `packages/mcp` (`@classroomio/mcp`) | published stdio MCP server "classroomio-course-authoring"; 17 tools (list_org_courses, get_course_structure, update_course_landing_page, reorder_course_content, create_course_draft[_from_course], get/update/tag/publish_course_draft[_to_existing_course], list/get/create/update_course_exercise, create_course_exercise_from_template, tag_courses) | Thin client to the API using an org automation key: `CLASSROOMIO_API_URL` (default api.classroomio.com - override!), `CLASSROOMIO_API_KEY`; hits the `authOrAutomationKey` routes under `/course/*` and `/organization/{course-import,tags,courses}`. Not a server inside the API; not required to run the LMS |
| `packages/analytics` | in-product analytics: browser beacon client, event taxonomy, `ingestEventBatch` (`POST /dash/track`), daily rollup (`runAnalyticsRollupDaily`) into `analytics_*` tables | none external (PostHog/umami removed in Phase 0 and covered by `no-phone-home.test.ts`) |
| `packages/question-types` | shared question-type registry, scoring rules, answer codecs, validation (radio, checkbox, textarea, true/false, numeric, fill-blank, star rating, thumbs, video recording...) used by dashboard + API | none |
| `packages/utils` (`@cio/utils`) | constants (`ROLE`, result values, unit types, notification categories, rate limits, error codes), pure auth predicates/Actor (`auth/*`), zod validation schemas for every route (`validation/*`), sanitize/slug/currency helpers, agent model list | none |
| `packages/db` | Drizzle schema, Better Auth instance (`auth.ts`; plugins `admin()`, `loginLink()`, `customSession()`, `sso()`+`tokenExchange()` only when not self-hosted), `resolveActor` (`actor.ts`), audit (`audit.ts`), `system-events.ts`, queries, scripts | Postgres; optional Google OAuth removed |
| `packages/email`, `packages/jobs` | see sections 4-5 | |
| `packages/ui`, `course-app`, `storybook`, `tsconfig` | frontend/tooling only | |

Other external calls the API can make (all env-gated): Unsplash (`UNSPLASH_API_KEY`), Sentry (`SENTRY_DSN`), YouTube metadata, Polar billing (`POLAR_*`, dashboard only), Cloudflare/Approximated custom-domain edge (cloud only). Full egress table: `docs/CODEMAP.md` section 10 and `docs/INTEGRATIONS.md`.

---

### 7. Tests

- Run API suite: `pnpm --filter @cio/api test` (= `vitest run`; config `apps/api/vitest.config.ts` aliases `@cio/db/*` and `@cio/core/*` to their `dist/` so **build the shared packages first: `pnpm build`**). DB is mocked (`vi.mock`), so no database/Redis/Supabase is needed. 71 `*.test.ts` files under `apps/api/src` (e.g. `__tests__/authz/` guard matrices, `marking`, `messaging`, `registration*`, `no-phone-home`, `error-hygiene`).
- Documented baseline (`docs/PHASE10.md`, `docs/BASELINE.md`): **api 523 pass / 0 fail, all 67 files load**; `@cio/email` 19 pass (`pnpm --filter @cio/email test`); `@cio/question-types` 33 pass; `@cio/course-app` 1. Known accepted gap: `@cio/dashboard` jest suite cannot start (F2, owner-signed; dashboard verified by `svelte-check` + `vite build` + per-role manual matrices). No CI workflow runs tests (CI builds only). Not re-run during this analysis (read-only brief).
- Fresh-environment verification suggestions: `pnpm install` (Node ^20.19.3, pnpm 10.19), `pnpm build`, API tests, then a live smoke per `docs/DEPLOY.md` section 5: login per role, one upload (presign PUT/GET on private bucket), one marking, security headers, `/health`.

### 8. Replication checklist (condensed)
1. New Supabase project (PG17): create buckets `documents`,`videos` (private), `media` (public), S3 keys; capture pooler 6543 + session 5432 URLs.
2. Provision Redis; set envs per `docs/ENV.md` (`PUBLIC_IS_SELFHOSTED=true` both sides, `BETTER_AUTH_SECRET`, `PRIVATE_SERVER_KEY`, `DASHBOARD_ORIGIN`, `PUBLIC/PRIVATE_SERVER_URL`, `DATABASE_URL`, `DIRECT_DATABASE_URL`, `OBJECT_STORAGE_*`, `REDIS_URL`, `SMTP_*`, optional AI keys).
3. `pnpm --filter @cio/db db:setup` (27 migrations + roles 1-4 + submission statuses + 14 question types).
4. Enable RLS on all 119 public tables (no policies).
5. Run a bootstrap script (section 3.7) for the Gecko organization, owner user, ADMIN membership (first = super admin) and ENTERPRISE selfhosted plan.
6. Rebrand email constants/templates/logo/footer + sender env; configure SMTP; optional external cron for `/internal/*`.
7. Smoke test per DEPLOY.md.


---

# Appendix E — Infrastructure, integrations, env, deploy, branding, course copy

## 30 - Infra, integrations, env, deploy, branding and course-copy for "Gecko Programmes" (`geckoprogrammes`)

Source: `C:\Users\PC\Projects\LMSclassroom` (PearlLMS = hard fork of ClassroomIO, AGPL-3.0, `main`, 1928 commits).
New site target: repo `Integer-Training/newlmsgecko`, own Supabase project, own DO droplet, own domain, own SMTP sender domain.
Read-only research. No secret values are reproduced anywhere in this file.
Sources actually read: docs/DEPLOY, RUNBOOK, ENV, INTEGRATIONS, CI, FORK, TODO-BRANDING, ONBOARDING-MODEL, PHASE7, PREVIEW_ENV.md, `.env.example`, `.env.deploy.example`, `apps/{api,dashboard,jobs,website}/.env.example`, `packages/db/.env.example`, `docker-compose{,.deploy,.images}.yaml`, `docker/Caddyfile`, `docker/Dockerfile.{api,dashboard,jobs}`, `docker/entrypoint-api.sh`, `.github/workflows/*`, `packages/db/src/schema.ts`, `apps/api/src/services/course/clone.ts`, plus owner memory notes for facts that are NOT in the repo (marked **[memory]**).

### 0. Headline findings / surprises (read first)

1. **There is NO Pearl CRM integration code in this repo** (and none referencing this LMS in `project-spark-969c9451`). `grep -i crm` over apps/packages/docs finds nothing relevant. No outbound webhook, no CRM client, no CRM env var. The only machine-to-machine surface that exists is `POST /register` and `GET /register/courses`, guarded by `Authorization: Bearer <PRIVATE_SERVER_KEY>` (see 2.8). If the live Pearl LMS talks to the CRM, it does so out-of-repo (CRM reading the LMS Supabase DB directly, or a manual process). **Action: ask the owner what "same Pearl CRM integration" means before building anything** - section 2.8 lists the options.
2. **`~/deploy.sh` is not in the repo.** It lives only on the droplet (`/root/deploy.sh`, repo at `/opt/pearllms`). Section 4 reconstructs it from DEPLOY.md/RUNBOOK.md + owner notes. The repo has no deploy automation and **no CI deploy**; all publish/deploy workflows are manual-dispatch only and point at ClassroomIO's own R2/registry (useless for Gecko; leave disabled).
3. **No memory limits and no `mem_limit`/`deploy.resources` in any compose file.** Memory protection is only: 4 GB swap on the droplet + sequential builds. Dashboard Docker build hard-codes `NODE_OPTIONS=--max-old-space-size=8072` (8 GB heap on a 3.8 GB box => heavy swap).
4. **The brand shown to users is already "Integer Training LMS"** (a previous rebrand pass replaced "ClassroomIO"), NOT "Pearl". "Pearl LMS" survives only in 13 page `<title>`s, one tutor dialog, and examples. The org name/logo/OG come from the **organization DB row** at runtime (`name`, `site_name`, `avatar_url`), so most branding is DB data, not code. (section 5)
5. **Email From/footers**: `SMTP_SENDER`/`SMTP_REPLY_TO` are env-driven, but many API services hard-code the display name `"<org> (via Integer Training LMS)"` and the shared email masthead still loads a **ClassroomIO-hosted logo** (`brand.cdn.clsrio.com`) plus `classroomio.com` links. These need code edits for Gecko.
6. **Supabase RLS**: Drizzle connects as the `postgres` owner (bypasses RLS) and the app never uses supabase-js, but a fresh Supabase project exposes `public` tables to PostgREST/anon key. Prod has RLS enabled on all tables + an event trigger `ensure_rls_on_new_tables` **[memory]** - these are NOT in the repo's migrations. Replicate on the new project (section 2.1).
7. **Prod email was deliberately dormant at go-live (2026-08)** **[memory]**; email-verify nag was bypassed by backfilling `email_verified=true`. For Gecko, configure real SMTP *before* inviting users, or accept the same workaround. Plan of record was SES via the Pearl Email Engine (needs a transactional-send API that did not exist then).
8. Dashboard container internal port is **3082** (compose env `PORT: 3082`; Dockerfile `EXPOSE 3000` is stale), API **3081** (older docs say 3002 - that is local dev only).

---

### 1. Architecture diagram (production, "Shape A")

```
                                   INTERNET
                                      |
        learners / staff browsers     |   DNS (registrar or DO DNS)
        https://<APP_DOMAIN>          |   A   <APP_DOMAIN>  ->  <droplet public IPv4>
                                      |   (optional AAAA ->  droplet IPv6)
                                      v
 +--------------------------- DigitalOcean droplet "geckolms" (Ubuntu 24.04) -----------------------------+
 |  ufw: allow 22/tcp (SSH key only), 80/tcp, 443/tcp ; DO Cloud Firewall mirrors this                     |
 |  4 GB swapfile (needed for the dashboard build)       repo clone: /opt/<name>   .env (chmod 600)        |
 |                                                                                                         |
 |  docker network (compose default bridge, project name = dir name)                                       |
 |                                                                                                         |
 |  +----------------------+  80,443 published   +-----------------------+                                 |
 |  | caddy                |-------------------->| dashboard             |  SvelteKit adapter-node         |
 |  | caddy:2-alpine       |  reverse_proxy      | container: *-dashboard|  PORT 3082  (healthcheck: none) |
 |  | container: *-caddy   |  dashboard:3082     | built from             |  ORIGIN=PUBLIC_APP_URL          |
 |  | Let's Encrypt auto   |                     | docker/Dockerfile.     |  BODY_SIZE_LIMIT=26214400       |
 |  | TLS for {$APP_DOMAIN}|                     | dashboard (node:20.19) |  /proxy/* and /api/auth/* are   |
 |  | HSTS+sec headers     |                     +-----------+-----------+  proxied SSR -> api             |
 |  | vols: caddy-data,    |                                 | http://api:3081 (internal only)           |
 |  |       caddy-config   |                                 v   Authorization: Bearer PRIVATE_SERVER_KEY|
 |  +----------------------+                     +-----------------------+                                |
 |                                               | api                    |  Hono on node (node:20.19-slim)|
 |   NOT published to host:                      | container: *-api       |  PORT 3081                     |
 |   api 3081, redis 6379                        | entrypoint: db:setup   |  healthcheck GET / on :3081    |
 |                                               |  then pnpm @cio/api    |  /health = liveness (proxied   |
 |                                               |  start                 |   publicly as /proxy/health)   |
 |                                               +----+---------+---------+                                |
 |                                                    |         | BullMQ enqueue                           |
 |                                                    |         v                                          |
 |                          +-------------------------+--+  +-----------------------+                     |
 |                          | redis                       |  | jobs (worker)         |                     |
 |                          | redis:7-alpine              |<-| container: *-jobs     |                     |
 |                          | --appendonly yes            |  | node:20-bookworm-slim |                     |
 |                          | vol redis-data, redis:6379  |  | + ffmpeg ; no port    |                     |
 |                          +-----------------------------+  | email/media workers   |                     |
 |                                                           +----------+------------+                     |
 +---------------------------------------------------------------------|------------------------------------+
             (api + jobs egress)                                        |
   +------------------+-------------------+----------------------+------+
   |                  |                   |                      |
   v                  v                   v                      v
 Supabase Postgres   Supabase Postgres   Supabase Storage (S3)    SMTP provider (587 STARTTLS / 465 TLS)
 TRANSACTION POOLER  DIRECT / SESSION    https://<ref>.storage.   from: no-reply@<sender-domain>
 :6543  (runtime)    :5432 (migrations   supabase.co/storage/v1/s3  SPF + DKIM + DMARC on <sender-domain>
 DATABASE_URL        db:setup at API     buckets:
 prepare:false,      boot only)            documents (PRIVATE)  presigned PUT/GET (browser -> Storage)
 ssl=require         DIRECT_DATABASE_URL   videos    (PRIVATE)  presigned
                                           media     (PUBLIC)   /object/public/media/... direct <img>
 Browser -> Storage directly for presigned uploads/downloads (CSP connect-src/img-src must list the host).

 Pearl CRM  : no code-level link in this repo (see section 2.8).
 Not used   : Postgres container, MinIO, Mailpit (local dev only); Cloudflare R2; Sentry; PostHog; Umami.
 Monitoring : DO Uptime checks on /login and /proxy/health (owner-configured, no agent).
```

Container table (prod `docker-compose.deploy.yaml`; **rename `container_name` values `pearl-*` to `gecko-*`**):

| service | container_name (Pearl) | image / build | internal port | published | healthcheck | mem limit | volumes | depends_on |
|---|---|---|---|---|---|---|---|---|
| redis | `pearl-redis` | `redis:7-alpine`, `redis-server --appendonly yes` | 6379 | none | `redis-cli ping` 5s | none | `redis-data:/data` | - |
| api | `pearl-api` | build `docker/Dockerfile.api` (node:20.19-slim, pnpm 10.19.0) | 3081 | none | node fetch `http://localhost:3081/` every 10s, start_period 40s, 12 retries | none | - | redis healthy |
| dashboard | `pearl-dashboard` | build `docker/Dockerfile.dashboard` (arg `PUBLIC_IS_SELFHOSTED=true`) | 3082 | none | none | none | - | api healthy |
| jobs | `pearl-jobs` | build `docker/Dockerfile.jobs` (node:20-bookworm-slim + ffmpeg), `CMD node apps/jobs/dist/index.js` | none | none | none | none | - | redis healthy |
| caddy | `pearl-caddy` | `caddy:2-alpine`; `./docker/Caddyfile` ro | 80/443 | **80:80, 443:443** | none | none | `caddy-data:/data`, `caddy-config:/config` | dashboard |

All five `restart: unless-stopped`. Named volumes: `redis-data`, `caddy-data` (holds the Let's Encrypt account + certs - do not delete or you will re-issue and may hit rate limits), `caddy-config`.

Caddy (`docker/Caddyfile`): single site block `{$APP_DOMAIN}`; `encode zstd gzip`; headers `Strict-Transport-Security max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options nosniff`, `X-Frame-Options SAMEORIGIN`, `Referrer-Policy strict-origin-when-cross-origin`, `Permissions-Policy geolocation=(), microphone=(), payment=(), usb=()`, `-Server`; then `reverse_proxy dashboard:3082`. It carries no brand string; uses only `APP_DOMAIN` env. **Caution: HSTS preload + includeSubDomains - do not point the apex of a domain that hosts other sites at this; use a dedicated subdomain.** No request-body limit is set in Caddy; upload cap is the dashboard `BODY_SIZE_LIMIT` (25 MB) and the presigned-direct path for big files.

Not-in-prod compose files: `docker-compose.yaml` (local: cio-postgres, cio-redis, cio-mailpit, cio-minio, cio-api/dashboard/jobs), `docker-compose.images.yaml` (pull published ClassroomIO images - unused), `docker/coolify/` (unused). Port map local dev: dashboard 5173, api 3002, Mailpit SMTP 127.0.0.1:1025.

---

### 2. External connections (what, where to create, exact settings, env vars)

#### 2.1 Supabase project (Postgres + Storage) - REQUIRED

- **Used for**: all app data (Postgres via Drizzle ORM / postgres-js) and all files (Storage via S3 API with presigned URLs). The app does **not** use supabase-js, Supabase Auth, Realtime or Edge Functions (auth = Better Auth tables `user/session/account/verification` in the same DB).
- **Create at**: supabase.com dashboard -> New project (own org/project; name e.g. `GECKOLMS`). Pearl prod = project `cvtmymxxjgjshrzsjxnj` "LMSCLASSROOM", **eu-west-1**, Postgres 17 **[memory]**; droplet is DO `lon1`.
- **Settings**
  - Region: same region as the droplet's nearest option (UK/EU data -> keep EU; eu-west-1 matches prod, eu-west-2 London is also fine). Pick once - cannot change.
  - Plan: **Pro** if you want the RUNBOOK commitments (PITR 7-day + daily backup, 30-day retention). Free tier has no PITR and pauses after inactivity.
  - Database password: generate a strong one (letters/digits; if you include `@:/?#` it must be URL-encoded in the connection strings). Store in vault only.
  - **Connection strings** (Dashboard -> Connect): 
    - `DATABASE_URL` = **Transaction pooler**, `postgresql://postgres.<ref>:<pw>@aws-1-<region>.pooler.supabase.com:6543/postgres` (runtime for API + jobs; driver sets `prepare:false` and `ssl:'require'`).
    - `DIRECT_DATABASE_URL` = **Direct** `db.<ref>.supabase.co:5432` **or, because DO droplets are IPv4-only, the Session pooler** `aws-1-<region>.pooler.supabase.com:5432` (this is what prod uses). Used ONLY by `db:setup`/drizzle-kit at API boot (DDL, advisory lock `pg_advisory_lock(4242424242)`).
    - `DATABASE_SSL` unset (SSL required). `DATABASE_POOL_MAX` optional (tune against pooler client limit; two services use the pool).
  - **Storage -> S3 Connection**: enable S3 protocol; create **S3 Access Keys** (Project Settings -> Storage -> S3 Access Keys) -> `OBJECT_STORAGE_ACCESS_KEY_ID`/`..._SECRET_ACCESS_KEY` (shown once).
    - `OBJECT_STORAGE_ENDPOINT` = `OBJECT_STORAGE_PUBLIC_ENDPOINT` = `https://<ref>.storage.supabase.co/storage/v1/s3`
    - `OBJECT_STORAGE_REGION` = project region (e.g. `eu-west-1`); `OBJECT_STORAGE_FORCE_PATH_STYLE=true` (mandatory).
    - **Buckets to create by hand** (the repo never creates them): 
      | bucket | visibility | contents | env |
      |---|---|---|---|
      | `documents` | **private** | lesson materials (`materials/{courseId}/...`), learner coursework (`coursework/...`), tutor feedback files | `OBJECT_STORAGE_BUCKET_DOCUMENTS` |
      | `videos` | **private** | uploaded lesson videos + HLS output | `OBJECT_STORAGE_BUCKET_VIDEOS` |
      | `media` | **public** | course images, avatars, org logo, thumbnails, OG images | `OBJECT_STORAGE_BUCKET_MEDIA`, `OBJECT_STORAGE_MEDIA_PUBLIC_BASE_URL=https://<ref>.storage.supabase.co/storage/v1/object/public/media` |
    - File-size limit: leave `documents` bucket **no per-file limit** (app caps govern: `UPLOAD_MAX_*_MB`, default document cap 50 MB **[memory]**); the global Storage limit (Settings -> Storage) must be >= the largest cap you set (video 800 MB default needs >= 800 MB; free tier global cap is 50 MB!).
    - **CORS**: nothing in the repo configures bucket CORS; prod works with Supabase's default S3/presigned behaviour (browser `PUT`/`GET` straight to `<ref>.storage.supabase.co`). After creating the project, smoke-test a browser upload; if blocked, add the app origin in Storage settings. The real gate is the app **CSP**: set `CSP_CONNECT_SRC_DOMAINS` and `CSP_MEDIA_SRC_DOMAINS` to `https://<ref>.storage.supabase.co` (img/media/connect), else uploads and public images are blocked by CSP.
    - Also add the Storage host to any `CSP_FRAME_SRC_DOMAINS` only if PDFs are iframed from it (prod does not need it).
  - **Row Level Security**: run, after first boot, on the new project (mirrors prod **[memory]**): enable RLS on every `public` table (`DO $$ ... ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) and create the event trigger `ensure_rls_on_new_tables` so future Drizzle tables are auto-protected. Drizzle connects as `postgres` owner so the app is unaffected; this only closes the PostgREST/anon-key door. Check Supabase "Security Advisor" afterwards.
  - Roles: `db:setup` creates `authenticated` and `anon` roles if absent (harmless on Supabase - they already exist).
  - Extensions: none required beyond defaults (`gen_random_uuid()` is built into PG13+).
- **Env feeding**: `DATABASE_URL`, `DIRECT_DATABASE_URL`, `DATABASE_SSL`, `DATABASE_POOL_MAX`, all `OBJECT_STORAGE_*`, `CSP_CONNECT_SRC_DOMAINS`, `CSP_MEDIA_SRC_DOMAINS`.
- **Fresh DB bootstrap**: first API boot runs `baselineMigrationsIfNeeded` then `drizzle-kit migrate` (27 migrations `0000`..`0026`) then the **essential seed** (`seed --roles --submissions --question-types`) on *every* boot (idempotent). No org or user is created. Bootstrap the first org/admin by opening `https://<APP_DOMAIN>/signup` on the empty DB (`signup-guard.ts`: with zero orgs, self-hosted signup is allowed), then complete `/onboarding` (org name **Gecko Programmes**, siteName `geckoprogrammes`). The first org creates the single-org lock (`createOrganizationWithOwner` refuses a 2nd org); after that signup is invite-only and the registration form is the only public door. First signup is auto-email-verified (`create-profile.ts`). Emergency password reset: `SET_PW_EMAIL=... SET_PW_PASSWORD=... pnpm --filter @cio/db exec tsx src/scripts/set-password.ts` (resets existing users only).

#### 2.2 DigitalOcean droplet - REQUIRED

- **Create at**: cloud.digitalocean.com -> Droplets. Prod: `pearllms`, Ubuntu 24.04, **2 vCPU / 4 GB (3.8 GB usable), lon1**, 4 GB swap added manually, IP `<pearl droplet IP — see owner notes>`.
- **Size recommendation for Gecko: 4 vCPU / 8 GB (Basic Premium/Regular, ~$48/mo, e.g. `s-4vcpu-8gb`) + 4 GB swap.** Reason: runtime footprint is small (<1.5 GB) but every deploy builds the SvelteKit dashboard on-box with an 8 GB Node heap; on 3.8 GB it swaps for 20-45 min and degrades the live site (load avg 8; 2026-10-20 incident where two concurrent deploys starved the box **[memory]**). If you must stay at 4 GB: keep 4 GB swap, deploy sequentially only, accept slow-site-during-deploy. Better long-term (not implemented in repo): build images in GitHub Actions and push to GHCR, then `docker compose pull && up -d`.
- **Settings**
  - Region `lon1` (or `ams3`/`fra1`; keep close to Supabase region). IPv4 required; enable IPv6 optionally. Monitoring agent: enable (free).
  - SSH: add a new ed25519 key (`ssh-keygen -t ed25519 -f ~/.ssh/geckolms_deploy`); password auth off. Prod key file name `pearllms_deploy` - do **not** reuse it for Gecko.
  - Firewall: DO Cloud Firewall inbound 22 (restrict to your IPs if static), 80, 443; all outbound. On host: `ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable`. Do **not** publish 3081/3082/6379 (compose does not).
  - Swap: `fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab` (+ `vm.swappiness=10`).
  - Install: `apt-get update && apt-get install -y ca-certificates curl git; curl -fsSL https://get.docker.com | sh; docker compose version`.
  - Outbound SMTP: DO blocks port 25 only; 587/465 work.
  - Backups: DO droplet backups optional (state is in Supabase; Redis holds only queue/rate-limit state).
- **Clone**: `git clone https://github.com/Integer-Training/newlmsgecko.git /opt/geckolms` (repo is public; no deploy key needed; if private use a read-only deploy key).
- **Env**: none directly; droplet `.env` (section 3).

#### 2.3 DNS + TLS - REQUIRED

- Registrar / DNS host of the new domain. Records:
  | type | name | value |
  |---|---|---|
  | A | `<APP_DOMAIN>` (e.g. `learn.<gecko-domain>`) | droplet IPv4 |
  | AAAA | same | droplet IPv6 (only if IPv6 enabled; otherwise omit) |
  | CAA (optional) | apex | `0 issue "letsencrypt.org"` |
  TTL 300 during cutover. Must resolve **before** first `up -d` so Caddy can obtain the cert (HTTP-01 on :80 / TLS-ALPN on :443; no DNS API token needed). Single hostname only - there is no wildcard/tenant subdomain in self-hosted mode (`PRIVATE_APP_HOST`/`PRIVATE_APP_SUBDOMAINS` are ignored).
- TLS: Let's Encrypt via Caddy, auto-renew, certs persisted in `caddy-data`. No Cloudflare proxying needed (if you proxy through Cloudflare use "Full (strict)" and disable "Always online"/caching of `/proxy`).
- Env: `APP_DOMAIN` (bare host, no scheme), `PUBLIC_APP_URL` (`https://` + same host; feeds API `PUBLIC_SERVER_URL`/`DASHBOARD_ORIGIN`/`TRUSTED_ORIGINS` and dashboard `ORIGIN`). Auth cookies are host-only (`AUTH_COOKIE_DOMAIN` unset); cookie prefix is `classroomio` (leave).
- Uptime: DO Monitoring -> Uptime checks on `https://<APP_DOMAIN>/login` (expect 200) and `https://<APP_DOMAIN>/proxy/health` (body contains `"status":"ok"`); alert + "cert expires <14 days".

#### 2.4 SMTP / transactional email - REQUIRED for real use

- **Used for**: auth emails (verify, forgot/reset password, email change) sent **synchronously by the API**; everything else (invites, coursework notifications, announcements, registration alerts, session reminders) via the **jobs worker**. Both processes need the same SMTP vars. Provider-agnostic nodemailer; `ZOHO_TOKEN` switches to ZeptoMail HTTP API instead (leave unset). Pearl's planned provider = AWS SES via Pearl Email Engine **[memory]**; DEPLOY.md lists ZeptoMail/SES/Postmark/Resend as options.
- **Create at**: chosen provider console (own account/sub-account for Gecko so reputation and bounce handling are isolated).
- **Settings**
  - Port 587 (STARTTLS enforced) or 465 (implicit TLS). **Never set `SMTP_ALLOW_INSECURE` in prod** (it drops TLS/auth; Mailpit-only).
  - `SMTP_SENDER` = `"Gecko Programmes" <no-reply@<sender-domain>>`, `SMTP_REPLY_TO` = `"Gecko Programmes Support" <support@<gecko-domain>>` (full quoted `"Name" <addr>` form).
  - Sender domain: use a dedicated subdomain (e.g. `mail.<gecko-domain>`) to keep reputation separate; verify the domain/identity in the provider.
  - **SPF**: TXT on sender domain - provider's include, e.g. SES `v=spf1 include:amazonses.com ~all`; if the provider sets a custom MAIL FROM, add its MX+SPF.
  - **DKIM**: publish the provider's 2-3 CNAMEs (SES Easy DKIM `<token>._domainkey.<domain>` -> `<token>.dkim.amazonses.com`) or TXT key (Postmark/ZeptoMail).
  - **DMARC**: TXT `_dmarc.<domain>` = `v=DMARC1; p=none; rua=mailto:dmarc@<gecko-domain>; fo=1` for the first 2-4 weeks, then `p=quarantine` then `reject`. Alignment: From domain must equal (or be a subdomain of) the DKIM-signing domain.
  - Provider side: SES must leave sandbox (production access) before mailing real learners; set up bounce/complaint handling (SNS or provider webhook) - the LMS has no bounce webhook, so watch the provider console.
  - Test after deploy: signup/verify, forgot password, invite, one coursework notification (`COURSEWORK_EMAILS_ENABLED` default on; set `"false"` to silence).
- **Env**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SENDER`, `SMTP_REPLY_TO`, (`SMTP_ALLOW_INSECURE` unset), (`ZOHO_TOKEN` unset), `COURSEWORK_EMAILS_ENABLED`.
- **Branding hardcodes still in the email layer** are listed in section 5 (masthead logo URL, footer, "via Integer Training LMS" From suffix, fallback addresses at `classroomio.com`).

#### 2.5 GitHub (repo + AGPL source link) - REQUIRED

- New repo `https://github.com/Integer-Training/newlmsgecko.git` (keep **public** - AGPL section 13 source offer; Pearl repo is public with 0 secrets in history **[memory]**). Push all history (preserves LICENSE, notices, upstream commit attribution). Keep `upstream` remote only for security cherry-picks (FORK.md policy) - never push to it.
- Droplet pulls from this repo; deployed commit must equal `origin/main` HEAD.
- GitHub Actions: the inherited workflows are all manual or irrelevant (docs/CI.md). Keep: `package-build-check`, `mcp-package-build-check`, `ui-prefix-check` (push/PR checks). Leave disabled: `upload-openapi-spec`, `docker-publish`, `deploy-embeds` (need ClassroomIO's Cloudflare R2/registry secrets). No secrets are required in GitHub for the Pearl setup. Optional improvement: add a workflow that builds and pushes images to GHCR (needs `GITHUB_TOKEN` packages:write only).
- Env: `PUBLIC_SOURCE_REPO_URL=https://github.com/Integer-Training/newlmsgecko` (see section 6).

#### 2.6 Redis (local container) - REQUIRED, no account

`redis:7-alpine` in compose, AOF persistence on `redis-data`. URL hard-wired in compose to `redis://redis:6379` for api and jobs (no env needed). Used for BullMQ queues, rate limits (prod-only), caches. Not exposed. If you ever move to managed Redis, set `REDIS_URL` and drop the container (the worker throws at boot if `REDIS_URL` is unset).

#### 2.7 Optional integrations (all OFF in Pearl; leave unset)

| integration | env | verdict (INTEGRATIONS.md) |
|---|---|---|
| OpenAI / Google / Anthropic / Moonshot (AI tutor, Whisper) | `OPENAI_API_KEY` (compose passes to jobs), `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`, `MOONSHOT_API_KEY` | keep inert; enabling sends learner content to a provider |
| Unsplash cover search | `UNSPLASH_API_KEY` | inert |
| Cloudflare R2 fallback / certificate rendering | `CLOUDFLARE_*` | unused (certificates disabled via `CERTIFICATES_ENABLED=false`) |
| Sentry | `SENTRY_*`, `PUBLIC_SENTRY_*` | inert (gated by not-self-hosted) |
| Google OAuth / Drive picker | `GOOGLE_CLIENT_ID/SECRET`, `PUBLIC_GOOGLE_PICKER_*` | removed/disabled |
| Polar, Stripe, Tinybird, UserJot, PostHog, Umami, license phone-home | - | removed or hard-gated off self-hosted |
| Public API v1 / automation keys / Zapier / MCP | - | routes return 404 when `PUBLIC_IS_SELFHOSTED=true` |
| External video embeds (YouTube/Drive/muse.ai) | `CSP_FRAME_SRC_DOMAINS` (+ `CSP_MEDIA_SRC_DOMAINS`) | browser-side only; add hosts you allow |

Expected live egress for Gecko = Supabase Postgres + Storage, SMTP host, optional embed hosts. Re-run the telemetry check from DEPLOY.md section 5 after go-live.

#### 2.8 Pearl CRM - "same integration" (NOT FOUND IN CODE)

What the repo actually contains that a CRM could touch:

| surface | direction | auth | payload / notes |
|---|---|---|---|
| `GET /register/courses` | inbound to LMS API | `Authorization: Bearer <PRIVATE_SERVER_KEY>` (`apiKeyMiddleware`) | returns published courses for the "course of interest" picker; `{success:true,data:[...]}` |
| `POST /register` | inbound to LMS API | same Bearer key + optional `x-forwarded-for` (client IP for per-IP rate limit) | JSON `{ fullName, email, requestedCourseId|null, <honeypot field> }` -> creates a **pending `registration` row** only (201 `{success:true,data:...}`); never a user. Duplicate email/open registration refused. Notifies Manager/Admin (`registration.submitted`). |
| Admin approval (UI) | internal | session | approve -> creates account + set-password invite email |
| Direct DB read | CRM -> LMS Supabase | Postgres creds / service role | **possible but undocumented**; Pearl LMS Supabase has `registration`, `learner_profile`, `organizationmember`, etc. |
| Outbound webhooks | LMS -> CRM | - | **none** (the `webhooks` BullMQ queue is declared but dead) |
| Public API v1 / MCP / Zapier | inbound | org automation key | **disabled (404)** when self-hosted |

Implications for Gecko: (a) if the CRM only needs to *push enquiries*, point it at `https://<APP_DOMAIN>/register` with Gecko's own `PRIVATE_SERVER_KEY` - but that key also authorises the dashboard<->API trust channel, so **prefer adding a dedicated CRM key/route** rather than sharing it; (b) if the CRM *reads* LMS data, it needs a read-only Postgres role (or view) on the new Supabase project - ask which tables; (c) the CRM is a different Supabase (`wxipygqoyjmbpvfbokdu`, project-spark repo) **[memory]** and was not examined for LMS references (none found by grep). **Must be confirmed with the owner before the build.**

---

### 3. Environment variables

Legend: **Build** = baked into the image at build time (needs rebuild); **Run** = read at process start from compose/`.env` (restart enough). "Prod compose" = passed by `docker-compose.deploy.yaml`. 🔒 = secret. "Req" = required for the Gecko prod deploy (Y), optional (o), or n/a-leave unset (-).

Compose never uses `env_file:`; values interpolate from the droplet `.env` into explicitly listed `environment:` keys, **so a var not listed in `docker-compose.deploy.yaml` is NOT passed to the container** (e.g. `UPLOAD_MAX_*`, `PUBLIC_APP_TITLE`, `COURSEWORK_EMAILS_ENABLED`, `MARKING_SLA_HOURS` would need compose edits to take effect in prod).

#### 3.1 Droplet `.env` (the only file you create on the server) - consumed by compose

| name | service(s) | req | build/run | how to obtain / value for Gecko | secret |
|---|---|---|---|---|---|
| `APP_DOMAIN` | caddy | Y | run | bare hostname, e.g. `learn.<gecko-domain>` | no |
| `PUBLIC_APP_URL` | api (`PUBLIC_SERVER_URL`,`DASHBOARD_ORIGIN`,`TRUSTED_ORIGINS`), dashboard (`ORIGIN`) | Y | run | `https://` + `APP_DOMAIN` | no |
| `BETTER_AUTH_SECRET` | api | Y | run | `openssl rand -hex 32`; unique per site; changing it logs everyone out | 🔒 |
| `PRIVATE_SERVER_KEY` | api, dashboard | Y | run | `openssl rand -hex 32`; must be identical in both containers (compose uses one var) | 🔒 |
| `DATABASE_URL` | api, jobs | Y | run | Supabase transaction pooler :6543 | 🔒 |
| `DIRECT_DATABASE_URL` | api | Y | run | Supabase session pooler/direct :5432 | 🔒 |
| `OBJECT_STORAGE_ENDPOINT` | api, jobs | Y | run | `https://<ref>.storage.supabase.co/storage/v1/s3` | no |
| `OBJECT_STORAGE_PUBLIC_ENDPOINT` | api, jobs | Y | run | same value as endpoint | no |
| `OBJECT_STORAGE_REGION` | api, jobs | Y | run | project region | no |
| `OBJECT_STORAGE_ACCESS_KEY_ID` | api, jobs | Y | run | Supabase S3 access key id | 🔒 |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | api, jobs | Y | run | Supabase S3 secret | 🔒 |
| `OBJECT_STORAGE_BUCKET_VIDEOS` | api, jobs | o (default `videos`) | run | bucket name | no |
| `OBJECT_STORAGE_BUCKET_DOCUMENTS` | api, jobs | o (default `documents`) | run | bucket name | no |
| `OBJECT_STORAGE_BUCKET_MEDIA` | api, jobs | o (default `media`) | run | bucket name | no |
| `OBJECT_STORAGE_MEDIA_PUBLIC_BASE_URL` | api, jobs | Y | run | `https://<ref>.storage.supabase.co/storage/v1/object/public/media` | no |
| `CSP_CONNECT_SRC_DOMAINS` | dashboard | Y | run | `https://<ref>.storage.supabase.co` | no |
| `CSP_MEDIA_SRC_DOMAINS` | dashboard | Y | run | `https://<ref>.storage.supabase.co` | no |
| `SMTP_HOST` | api, jobs | Y | run | provider host | no |
| `SMTP_PORT` | api, jobs | Y | run | `587` or `465` | no |
| `SMTP_USER` | api, jobs | Y | run | provider SMTP user | 🔒 |
| `SMTP_PASSWORD` | api, jobs | Y | run | provider SMTP password | 🔒 |
| `SMTP_SENDER` | api, jobs | Y | run | `"Gecko Programmes" <no-reply@<sender-domain>>` | no |
| `SMTP_REPLY_TO` | api, jobs | o | run | `"Gecko Programmes Support" <support@<gecko-domain>>` | no |
| `PUBLIC_SOURCE_REPO_URL` | dashboard | Y (AGPL) | **run** (`$env/dynamic/public`) | `https://github.com/Integer-Training/newlmsgecko` (compose default still points at LMSclassroom - edit default) | no |
| `DASHBOARD_BODY_SIZE_LIMIT` | dashboard (`BODY_SIZE_LIMIT`) | o (default 26214400 bytes) | run | raise if API image cap raised; fixes proxied-upload failures >512 KB | no |
| `OPENAI_API_KEY` | jobs | - | run | leave unset (AI/Whisper off) | 🔒 |

Hard-wired by compose (not in `.env`): `NODE_ENV=production`; `PORT` api 3081 / dashboard 3082; `PUBLIC_IS_SELFHOSTED='true'` (api run; dashboard **also a build arg - baked into client bundle**); `REDIS_URL=redis://redis:6379`; `PRIVATE_SERVER_URL=http://api:3081`; `OBJECT_STORAGE_FORCE_PATH_STYLE='true'`.

#### 3.2 Full catalogue of every variable the code can read

| name | service(s) | req | build/run | obtain / Gecko value | secret |
|---|---|---|---|---|---|
| `PUBLIC_IS_SELFHOSTED` | api, dashboard, db | Y | **build** (dashboard bundle) + run (api) | always `true`; must match both; restart api / rebuild dashboard if changed | no |
| `NODE_ENV` | all | Y | run | `production` | no |
| `DASHBOARD_ORIGIN` | api, db(auth), email links | Y | run | = `PUBLIC_APP_URL` | no |
| `PUBLIC_SERVER_URL` | api, dashboard | Y | run (dashboard: build for CSP `svelte.config.js` + runtime) | = `PUBLIC_APP_URL` in prod; local `http://localhost:3002` | no |
| `PRIVATE_SERVER_URL` | dashboard | Y | run | `http://api:3081` (internal) | no |
| `PRIVATE_SERVER_KEY` | api, dashboard | Y | run | random 32-byte hex | 🔒 |
| `TRUSTED_ORIGINS` | api | Y | run | = `PUBLIC_APP_URL` | no |
| `ORIGIN` | dashboard (SvelteKit CSRF) | Y | run | = `PUBLIC_APP_URL` | no |
| `PORT` | api, dashboard | Y | run | 3081 / 3082 (compose) | no |
| `BODY_SIZE_LIMIT` | dashboard (adapter-node) | o | run | bytes; compose default 26214400 | no |
| `BETTER_AUTH_SECRET` | api | Y | run | random | 🔒 |
| `AUTH_COOKIE_DOMAIN` | api | - | run | unset (host-only cookies) | no |
| `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` | api | - | run | unset (social login removed) | 🔒 |
| `LICENSE_KEY` | api | - | run | unset (phone-home removed) | 🔒 |
| `SSO_ENCRYPTION_KEY` | api | - | run | unset (SSO gated off) | 🔒 |
| `TOKEN_AUTH_SECRET` | dashboard | - | run | unset (token-auth gated off) | 🔒 |
| `DATABASE_URL` | api, jobs, db scripts | Y | run | Supabase :6543 | 🔒 |
| `DIRECT_DATABASE_URL` | api (db:setup), db scripts | Y | run | Supabase :5432 | 🔒 |
| `PRIVATE_DATABASE_URL` | api, jobs, db | - | run | legacy fallback; unset | 🔒 |
| `DATABASE_SSL` | api, jobs, db | - | run | unset; `disable` only for plain local PG | no |
| `DATABASE_POOL_MAX` | api, jobs | o | run | pool size | no |
| `SKIP_DB_SETUP` | api entrypoint | - | run | `true` skips migrations+seed (default false) | no |
| `REDIS_URL` | api, jobs | Y | run | `redis://redis:6379` (compose) | no |
| `OBJECT_STORAGE_ENDPOINT` / `_PUBLIC_ENDPOINT` / `_REGION` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` / `_FORCE_PATH_STYLE` / `_BUCKET_VIDEOS` / `_BUCKET_DOCUMENTS` / `_BUCKET_MEDIA` / `_MEDIA_PUBLIC_BASE_URL` | api, jobs | Y | run | see 3.1 (10 vars; keys are 🔒) | keys 🔒 |
| `CLOUDFLARE_ACCOUNT_ID`, `_ACCESS_KEY`, `_SECRET_ACCESS_KEY`, `_BUCKET_DOMAIN`, `_IMAGE_BUCKET_DOMAIN`, `_BUCKET_ID` | api, jobs | - | run | unset (R2 fallback) | 🔒 |
| `CLOUDFLARE_RENDERING_API_KEY` | api | - | run | unset | 🔒 |
| `CLOUDFLARE_API_TOKEN` | build script only (embeds upload) | - | n/a | never in runtime env | 🔒 |
| `HLS_SIGNING_SECRET` | api | - | run | unset (HLS cookie disabled self-hosted) | 🔒 |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASSWORD` `SMTP_SENDER` `SMTP_REPLY_TO` | api, jobs | Y (user/pass/reply-to depend on provider) | run | see 3.1 | user/pass 🔒 |
| `SMTP_ALLOW_INSECURE` | api, jobs | - | run | **unset in prod** (`true` only for Mailpit) | no |
| `ZOHO_TOKEN` | api, jobs | - | run | unset | 🔒 |
| `COURSEWORK_EMAILS_ENABLED` | api | o | run (read at call time) | default on; `"false"` disables both coursework mails (not passed by prod compose) | no |
| `MARKING_SLA_HOURS` | api | o | run | overrides marking SLA hours in caseload (not in compose) | no |
| `MEDIA_WORKER_CONCURRENCY`, `TRANSCRIBE_WORKER_CONCURRENCY`, `EMAIL_WORKER_CONCURRENCY`, `AGENT_COURSE_GENERATION_WORKER_CONCURRENCY` | jobs | o | run | defaults fine | no |
| `FFMPEG_PATH`, `FFPROBE_PATH` | jobs | - | run | unset (ffmpeg on PATH in image) | no |
| `QUEUE_DASHBOARD_PASSWORD`, `QUEUE_DASHBOARD_ADMIN_EMAILS`, `QUEUE_DASHBOARD_TOKEN` | api | o | run | `/admin/queues` hidden in prod unless one is set | 🔒 |
| `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`, `MOONSHOT_API_KEY`, `JINA_API_KEY` | api, jobs | - | run | unset | 🔒 |
| `AGENT_MAX_FETCHES_PER_CONVERSATION`, `AGENT_MAX_FETCHES_PER_ORG_PER_DAY`, `AI_TUTOR_CAP_ENFORCED` | api | - | run | unset | no |
| `UNSPLASH_API_KEY` | api, dashboard | - | run | unset | 🔒 |
| `TINYBIRD_TOKEN`, `TINYBIRD_BASE_URL` | api | - | run | unset (hard-gated off) | 🔒 |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` | api | - | run | unset | DSN 🔒 |
| `PUBLIC_SENTRY_DSN`, `PUBLIC_SENTRY_ENVIRONMENT`, `PUBLIC_SENTRY_TRACES_SAMPLE_RATE`, `PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE`, `PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE` | dashboard | - | build/run | unset (replay-on-error defaults 1!) | DSN 🔒 |
| `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_TOKEN_PACK_PRODUCT_ID`, `POLAR_SERVER` | dashboard/api | - | run | unset (routes deleted) | 🔒 |
| `APPROXIMATED_API_KEY`, `_TARGET_ADDRESS`, `_DNS_TARGET_IP`, `_DNS_TARGET_CNAME`; `PROJECT_ID_VERCEL`, `TEAM_ID_VERCEL` | api | - | run | cloud-only; unset | 🔒 |
| `OPENAPI_URL`, `PUBLIC_API_OPENAPI_URL`, `PUBLIC_EMBED_BASE_URL` | api/dashboard | - | run | unset (vendor docs/embeds) | no |
| `PUBLIC_SOURCE_REPO_URL` | dashboard | Y | run | AGPL link target | no |
| `PUBLIC_APP_TITLE`, `PUBLIC_APP_DESCRIPTION`, `PUBLIC_OG_IMAGE_URL` | dashboard | o | run (`$env/dynamic/public`) | override meta tags; in self-hosted the title/OG normally derive from the **org row** (`metaTags.server.ts`); not passed by prod compose | no |
| `PUBLIC_MEDIA_CDN_URL` | dashboard | - | run | unset | no |
| `PRIVATE_APP_HOST`, `PRIVATE_APP_SUBDOMAINS` | dashboard | - | run | ignored when self-hosted | no |
| `PUBLIC_GOOGLE_PICKER_CLIENT_ID`, `PUBLIC_GOOGLE_PICKER_API_KEY` | dashboard | - | build/run | unset | 🔒 |
| `ALLOWED_EXTERNAL_DOMAINS` | dashboard | - | run | overrides all per-directive CSP lists (avoid) | no |
| `CSP_SCRIPT_SRC_DOMAINS`, `CSP_STYLE_SRC_DOMAINS`, `CSP_CONNECT_SRC_DOMAINS`, `CSP_FRAME_SRC_DOMAINS`, `CSP_FONT_SRC_DOMAINS`, `CSP_MEDIA_SRC_DOMAINS`, `CSP_FRAME_ANCESTORS_DOMAINS` | dashboard | connect+media Y | run (self-hosted base list is built at build; extras at runtime) | comma-separated hosts | no |
| `UPLOAD_MAX_DOCUMENT_MB`, `_IMAGE_MB`, `_VIDEO_MB`, `_EXERCISE_FILE_MB`, `_AGENT_DOCUMENT_MB`, `_LANDING_IMAGE_MB`, `_THUMBNAIL_MB` | api **and** dashboard | o | run | defaults 50/5/800/2/5/0.5/5; set on both if changed (not in prod compose) | no |
| `CI_ENVIRONMENT` | dashboard build | - | build | `cloudflare` switches adapter; leave unset | no |
| `CIO_VERSION` | images compose | - | - | unused | no |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | local compose only | - | - | unused in prod | 🔒 |
| `PGDUMP_URL`, `PG_DUMP_*`, `PG_RESTORE_*`, `PSQL_BIN`, `PGSSLROOTCERT`, `PUSH_DUMP_SSLMODE`, `OLD_BUCKET_DOMAIN`, `NEW_BUCKET_DOMAIN`, `BACKFILL_*`, `RESET_BETTER_AUTH_BEFORE_SUPABASE_MIGRATE`, `EXERCISE_BACKFILL_BATCH_SIZE`, `SET_PW_EMAIL`, `SET_PW_PASSWORD`, `SEED_VOLUME_CONFIRM`, `VOLUME_TUTORS`, `VOLUME_LEARNERS` | one-off `packages/db` scripts | - | run (manual) | operator-supplied at script run; never in the service env | PW 🔒 |
| `TEST_*` / vitest | tests | - | - | none needed | - |

Counts: **droplet `.env` keys = 25**; **~140 distinct env var names** are readable by the code, examples or compose (144 raw grep hits incl. 3 non-env constants and 3 website-only vars).

---

### 4. Deploy pipeline

#### 4.1 First deploy (from DEPLOY.md, adapted)
1. DO droplet + swap + docker (2.2); DNS A record live (2.3); Supabase project, buckets, S3 keys, RLS (2.1); SMTP identity verified (2.4).
2. `git clone ... /opt/geckolms && cd /opt/geckolms`; `cp .env.deploy.example .env`; `chmod 600 .env`; fill section 3.1 (generate `BETTER_AUTH_SECRET` and `PRIVATE_SERVER_KEY` with `openssl rand -hex 32`). Leave `SMTP_ALLOW_INSECURE` unset.
3. `git rev-parse HEAD` (record; must equal `origin/main`).
4. `docker compose -f docker-compose.deploy.yaml up -d --build` (expect 25-45 min on 4 GB; do it **detached** - see 4.3).
5. Smoke (DEPLOY.md section 5): https 200 + valid cert, "Source code (AGPL-3.0)" link on login, `/proxy/health` ok, signup-bootstrap org + admin, create course + lesson, upload + download a file, raw object URL on private bucket denied (400), telemetry grep clean.

#### 4.2 `~/deploy.sh` (NOT in repo - reconstructed)
Lives at `/root/deploy.sh` on the droplet, written by the owner via a one-line SSH `printf`, run as `nohup /root/deploy.sh >/root/deploy.log 2>&1 &` (the agent's own SSH heredoc+nohup launch is blocked by the auto-mode classifier, so the owner launches it with the `!` prefix; the agent then polls `deploy.log`). Reconstruction consistent with the notes (sequential build, final marker line):

```bash
#!/bin/bash
set -e
cd /opt/pearllms                     # -> /opt/geckolms
echo "=== START $(date -u) ==="
git pull --ff-only
echo "deployed commit: $(git rev-parse HEAD)"
docker compose -f docker-compose.deploy.yaml build api        # sequential, NOT parallel
docker compose -f docker-compose.deploy.yaml build dashboard
docker compose -f docker-compose.deploy.yaml up -d --build    # reuses the just-built images; also builds jobs
docker compose -f docker-compose.deploy.yaml ps
echo "=== COMPLETE $(date -u) ==="
```
API-only change fast path (~3 min): `build api && up -d api` (dashboard image then lags - fine only when the diff is api-only). Jobs-only: `build jobs && up -d jobs`.

#### 4.3 Build/memory gotchas
- Dashboard build = `pnpm -r --filter @cio/dashboard... build` with `NODE_OPTIONS=--max-old-space-size=8072` (13.7k modules). On 3.8 GB + 4 GB swap: 17-25 min for the dashboard image alone, full deploy 25-45 min, load avg ~8, **live site slow but containers stay up** (not an OOM crash - check `docker ps` and `free -h` before assuming an outage).
- **Never run two deploys at once** (2026-10-20: two concurrent `deploy.sh` saturated the box and learners' requests timed out; recovery = kill the redundant run).
- Plain `up -d --build` builds api+dashboard+jobs **in parallel** -> memory thrash; build **sequentially** (above), detached with `nohup` so an SSH drop does not abort it (a killed client never runs the final `up -d`; buildkit continues server-side).
- Wait-loop gotcha: do not grep `deploy.log` for `ERROR:` - the Dockerfile echoes a literal `ERROR: Dashboard build output not found` guard string; match `failed to solve|exited with code [1-9]` and `=== COMPLETE ===`.
- Prod builds run a strict full `tsc` (no turbo cache): verify locally with `pnpm -r --filter @cio/dashboard... build` (needs `NODE_OPTIONS=--max-old-space-size=8192`) before deploying. `apps/api/tsconfig.json` excludes tests. Kill stray node/esbuild locally first.
- Docker layer cache: `pnpm fetch` layer re-runs only when `pnpm-lock.yaml`/`patches/` change. Prune occasionally: `docker image prune -f` (disk), keep `caddy-data`.
- With an 8 GB droplet the same build takes ~5-8 min and does not starve the site.

#### 4.4 Migrations
Automatic: api container entrypoint `docker/entrypoint-api.sh` -> `pnpm --filter @cio/db db:setup` -> create `authenticated`/`anon` roles if missing -> **advisory lock** -> `baselineMigrationsIfNeeded` (no-op on migrated DB; on empty DB runs all) -> `drizzle-kit migrate` over `DIRECT_DATABASE_URL` -> essential seed (roles, submissions, question types) -> `pnpm --filter @cio/api start`. Output is in `docker logs <api>` (NOT in deploy.log). `SKIP_DB_SETUP=true` skips it. A failure exits the container (restart loop) - read the api log. Migrations are forward-only; committed `.sql` in `packages/db/src/migrations` (27 files, `0000`..`0026`); new schema needs `pnpm --filter @cio/db db:generate` committed on `main`, and **new tables need RLS enabled** (event trigger handles it on Pearl).

#### 4.5 Rollback
`ssh root@<ip>; cd /opt/geckolms; git log --oneline -5; git checkout <good-hash>; docker compose -f docker-compose.deploy.yaml up -d --build; git rev-parse HEAD` (record). Then land the fix on `main`, `git checkout main && git pull`, redeploy (AGPL: droplet HEAD must equal `origin/main`). Schema is not auto-reverted - roll forward with a fix migration, or restore Supabase PITR to a scratch project (RUNBOOK section 4 drill).

#### 4.6 Logs, health, ops
- Logs: `docker compose -f docker-compose.deploy.yaml logs -f api|jobs|dashboard|caddy|redis` (container names `*-api`, `*-jobs`, `*-dashboard`, `*-caddy`, `*-redis`). No aggregator; logs are PII-clean. API errors carry `correlationId` (`x-correlation-id` header) - `logs api | grep <id>`.
- Health: `GET https://<APP_DOMAIN>/proxy/health` -> `200 {"status":"ok","service":"api",...}` (liveness only, no DB call); `GET /login` 200; `docker compose ps` all healthy; api/dashboard images have **no curl/wget** - probe with `docker exec <api> sh -lc "node -e \"fetch('http://localhost:3081/health').then(r=>console.log(r.status))\""`. Migrations: `logs api | grep -i migrat`.
- Monitoring: DO Uptime checks (2.3). Cadence: monthly `pnpm audit` + image refresh; quarterly restore drill (RUNBOOK section 7).

---

### 5. Branding inventory

Scope: whole repo, excluding `node_modules`, `.git`, `.svelte-kit`, `build`, `dist`, lockfile, sourcemaps, `CHANGELOG.md`. Deployed apps are `apps/dashboard`, `apps/api`, `apps/jobs` and the `packages/*` they import; **not deployed** (ignore for Gecko): `apps/website`, `apps/docs`, `apps/tenant-router`, `apps/course-app`, `apps/embeds`, `packages/course-app`, `packages/storybook`, `packages/mcp`, `prd/`, `skills/`, `prototypes/`, `docs/` (internal docs).

#### 5.1 Counts (grep, case-insensitive unless noted)

| pattern | whole repo (excl. build dirs/lockfile) | deployed apps+packages, user-visible |
|---|---|---|
| `Integer Training LMS` (current visible brand) | 336 occurrences in `apps/`+`packages/` (97 files): **123 in code/templates + 23 in `en.json` (146 rows below)** + **190 in the 9 other locale JSONs** (da 22, de 22, es 22, fr 22, pl 22, pt 22, ru 22, vi 21, hi 15) | all of them |
| `Pearl LMS` / `PearlLMS` / `Pearl` | 318 files contain "PearlLMS Phase n" **code comments** (leave); **user-visible = 28 rows** (13 page `<title>`s, 1 dialog sentence, env examples, tests/seeds) | 15 |
| `ePEARL`/`epearl`/`epearlacademy`/`learn.epearlacademy.com` | **1 hit in code**: `apps/api/src/__tests__/config/trusted-origin-selfhosted.test.ts:11`; rest in docs (`DEPLOY.md`, `RUNBOOK.md`, `ENV.md`, `INTEGRATIONS.md`, `FORK.md`...) and local untracked `.env` | 0 |
| `ClassroomIO` / `classroomio.com` / `clsrio.com` / `@classroomio` | 2,960 lines repo-wide (mostly `classroomio` API-client variable in `apps/dashboard`, 430 in `apps/docs`, 367 in `apps/website`, ~300 in `prd/`) | **170 rows** below that are real strings (vs. the client variable); ~62 more in the 9 non-English locale JSONs (7 per file; same 4 keys) |
| `Integer Training` / `integertraining` / `Integer-Training` | beyond the brand: `Integer-Training/LMSclassroom` repo URL (`source-code-link.svelte:6`, `.env.deploy.example`, `docker-compose.deploy.yaml`, `.env.example` of dashboard, FORK/DEPLOY docs) | repo URL = AGPL, see section 6 |
| bare `integer` | ~2,070 hits in `packages/db` = SQL/Drizzle `integer` column type - **NOT branding, ignore** | - |

**Total brand strings that must change for Gecko (deployed code): 146 (Integer Training LMS) + 28 (Pearl) + 170 (ClassroomIO/URLs, of which ~100 are low-value dead vendor links) = 344 rows, plus 190 + 62 locale values (mechanical find/replace in 9 JSON files).** Quickest safe path: one scripted replace of the literal `Integer Training LMS` -> `Gecko Programmes`, then hand-edit the Pearl/ClassroomIO tables.

#### 5.2 Brand lives in THREE places - change all three

1. **Organization DB row** (runtime, no code): `organization.name`, `site_name`, `avatar_url` (logo, upload via Settings -> Organization Profile), `landingpage`, `settings`, `customization`, `theme`. In self-hosted mode `metaTags.server.ts` derives `<title>`, `siteName`, OG image from `org.name`/`org.avatarUrl`; sidebar/login logo use `$currentOrg.avatarUrl || '/logo-192.png'`; email masthead uses the org logo + name when present (`buildMasthead`). **Set these in the onboarding step and Settings; this alone fixes most visible branding.** Gecko org: name `Gecko Programmes`, siteName `geckoprogrammes` (siteName is also the internal slug; lowercase, unique).
2. **Static assets and hardcoded strings** (code; tables below).
3. **Env**: `SMTP_SENDER`, `SMTP_REPLY_TO`, `PUBLIC_SOURCE_REPO_URL`, optional `PUBLIC_APP_TITLE`/`PUBLIC_APP_DESCRIPTION`/`PUBLIC_OG_IMAGE_URL`.

#### 5.3 Static assets to replace (all in `apps/dashboard/static/`)

| file | what it is | notes |
|---|---|---|
| `logo.svg`, `logo-16.svg/.png`, `logo-32.svg/.png`, `logo-192.svg/.png`, `logo-512.svg/.png` (512 = 1024x1024 RGBA) | app logo set: login/error pages (`/logo-512.png`), default sidebar fallback (`/logo-192.png`), plyr player overlay, onboarding, OG fallback (`new URL('/logo-512.png', origin)`), manifest icons | replace all 9 with Gecko logo (same sizes) |
| `favicon.ico` | `<link rel="icon" href="/favicon.ico">` in `routes/+layout.svelte:102`; 32px png at `:103` | replace |
| `classroomio-opengraph-image.png`, `classroomio-opengraph-image_launch.png` | stock OG images, no longer referenced by code in deployed paths (OG falls back to org logo / `/logo-512.png`) | replace or delete; rename optional |
| `manifest.json` | PWA: `"name":"ClassroomIO"`, `"short_name":"ClassroomIO"`, `theme_color #333333`, `background_color #ffffff`, icons logo-32/192/512 | change names to Gecko Programmes; keep colours |
| `images/classroomio-course-img-template.jpg` | default course thumbnail (referenced in 5 svelte files + `packages/ui/.../course-card/constants.ts`) | file name is a code reference - replace the *image content*, keep the filename (or rename in 6 places) |
| `images/learn-on-cio.jpg`, `images/org-header-banner.jpg`, `org-landingpage-*.jpeg`, `course-banner-image.png`, `certificate-template.*` | generic stock art; check for baked-in "ClassroomIO" text | eyeball before launch |
| `500-error.svg`, `unauthorized.svg`, `notfound.*` | illustrations (no brand text expected) | eyeball |
| `src/error.html` | static 500 page: logo `/logo-512.png`, alt text, `mailto:support@classroomio.com` | edit |
| `src/app.html` | `<meta name="theme-color" content="#333333">`, manifest link | colour unchanged |
| `static/zohoverify/verifyforzoho.html` | Zoho domain verification for Pearl's old domain | delete for Gecko |
| Email masthead image | `CLASSROOMIO_LOGO = https://brand.cdn.clsrio.com/cio-bg-transparent.png` in `packages/email/src/templates/default.ts:4` - **third-party hosted ClassroomIO logo shown atop every email that has no org logo/name** | host Gecko logo in the Supabase `media` bucket and point here (or ensure org avatar is always set) |

#### 5.4 Theme colour tokens (colours stay the same - listed for reference, do NOT change)

- `packages/ui/src/index.css`: light `--primary: oklch(0.488 0.243 264.376)`, `--primary-foreground oklch(0.97 0.014 254.604)`, `--sidebar-primary oklch(0.546 0.245 262.881)`, `--ring oklch(0.708 0 0)`, `--background oklch(1 0 0)`; dark `--primary oklch(0.424 0.199 265.638)`, `--background oklch(0.145 0 0)`; fallback hex `#1d4ee2` in gradient mixes (lines 243-264).
- `apps/dashboard/src/app.css:349-385`: `--primary: var(--color-blue-700)`, `--sidebar-primary blue-600/500`; an alternate lime theme block (`--color-lime-600`) at 376-385.
- `packages/email/src/templates/default.ts:3`: `DEFAULT_BUTTON_COLOR '#1D4EE2'`; org `themeColor` overrides button colour (sanitised).
- `manifest.json` / `app.html`: `#333333` theme colour, `#ffffff` background.
- Per-org colour can be set in DB (`organization.theme`) via Settings -> Customize LMS.

#### 5.5 Internal identifiers that must NOT be renamed (leave alone)

| identifier | where | why |
|---|---|---|
| `@cio/*` workspace packages (`@cio/api`, `@cio/db`, `@cio/ui`, `@cio/utils`, `@cio/core`, `@cio/email`, `@cio/jobs-worker`...), `@db/*`, `@api/*` aliases | every `package.json`, imports, Dockerfiles (`--filter @cio/api...`) | renaming breaks the pnpm workspace and Docker builds; invisible to users |
| `classroomio` API-client variable (`export const classroomio = hcWithType(...)` in `apps/dashboard/src/lib/utils/services/api/index.ts:259`) and its ~1,000 call sites | dashboard | pure code identifier |
| Better Auth `cookiePrefix: 'classroomio'` (`packages/db/src/auth.ts:109`) and cookie filters `c.name.includes('classroomio')` (`apps/dashboard/src/lib/utils/functions/cookies.ts:10,16,20`), `classroomio_locale` cookie/localStorage (`translations.ts:65-66`, `+layout.server.ts:56`) | auth + i18n | cookie names are matched by string in SSR cookie forwarding; renaming one place breaks login |
| localStorage keys `classroomio_*`, `classroomio-*`, `pearl.dismissedBroadcasts`, `pearl.tutorFeedback.*` | dashboard | per-browser UI state only; harmless to keep |
| i18n **keys** such as `classroomio_home`, `by_classroomio`, `classroomio_brand`, `custom_domain_not_classroomio`; widget `themePreset: 'classroomio'` enum (`packages/utils/src/validation/widget/widget.ts`) | locale JSON keys, widget schema | keys are code contract; only change the *values* |
| iCalendar UID suffix `@classroomio` (`session-invite.ts:24`, jobs `notify-session-update.ts:59`, `session-reminder-scan.ts:63`) | calendar invites | stable UIDs; changing duplicates events for existing subscribers |
| DB names: Postgres roles/tables, `drizzle` migration names, `cio-*` local compose container names, `PUBLIC_IS_SELFHOSTED`, `DASHBOARD_ORIGIN` | db/compose | internal |
| Code comments "PearlLMS Phase n ..." (318 files) | everywhere | documentation of the fork; rename/leave, no effect |
| `upstream` remote, `upstream-baseline` tag, LICENSE and ClassroomIO copyright headers | git / AGPL | **keep** (AGPL requires preserving notices) |

#### 5.6 Line-level inventory

Tables A (Integer Training LMS), B (Pearl) and C (residual ClassroomIO / vendor URLs) follow. "Type" legend: Meta = `<title>`/meta; Email = recipient-visible; UI copy = rendered text; Asset/CDN URL = third-party hosted resource ClassroomIO controls (may disappear - self-host); INTERNAL = do not rename. Row counts: **A = 146, B = 28, C = 170**.


##### A. "Integer Training LMS" - all non-locale occurrences in apps/ + packages/ (replace with "Gecko Programmes")

| file | line | string (trimmed) | type |
|---|---|---|---|
| `apps/api/src/routes/admin/queues.ts` | 43 | `title: 'Integer Training LMS Jobs'` | UI copy / fallback string |
| `apps/api/src/routes/admin/queues.ts` | 54 | `'WWW-Authenticate': 'Basic realm="Integer Training LMS Queues", charset="UTF-8"'` | UI copy / fallback string |
| `apps/api/src/services/course/invite.ts` | 381 | `from: buildEmailFromName(`${input.orgName} (via Integer Training LMS)`),` | Email From display name |
| `apps/api/src/services/course/invite.ts` | 411 | `from: buildEmailFromName('Integer Training LMS'),` | Email From display name |
| `apps/api/src/services/course/invite.ts` | 469 | `from: buildEmailFromName(`${input.orgName} (via Integer Training LMS)`),` | Email From display name |
| `apps/api/src/services/course/invite.ts` | 564 | `const orgName = courseOrgData.orgName || 'Integer Training LMS';` | UI copy / fallback string |
| `apps/api/src/services/course/notify-exercise.ts` | 55 | `const orgName = orgData.orgName || 'Integer Training LMS';` | UI copy / fallback string |
| `apps/api/src/services/course/notify-exercise.ts` | 63 | `fromName: buildEmailFromName(`${orgName} (via Integer Training LMS)`),` | Email From display name |
| `apps/api/src/services/course/payment-request.ts` | 30 | `const orgName = course.orgName || 'Integer Training LMS';` | UI copy / fallback string |
| `apps/api/src/services/course/payment-request.ts` | 66 | `from: buildEmailFromName('Integer Training LMS'),` | Email From display name |
| `apps/api/src/services/course/payment-request.ts` | 83 | `from: buildEmailFromName(`${orgName} - Integer Training LMS`),` | Email From display name |
| `apps/api/src/services/course/people.ts` | 72 | `const orgName = courseOrgData.orgName || 'Integer Training LMS';` | UI copy / fallback string |
| `apps/api/src/services/course/people.ts` | 111 | `from: buildEmailFromName(`${orgName} (via Integer Training LMS)`),` | Email From display name |
| `apps/api/src/services/course/people.ts` | 136 | `from: buildEmailFromName('Integer Training LMS'),` | Email From display name |
| `apps/api/src/services/course/people.ts` | 196 | `const orgName = courseOrgData.orgName || 'Integer Training LMS';` | UI copy / fallback string |
| `apps/api/src/services/course/people.ts` | 241 | `from: buildEmailFromName(`${orgName} (via Integer Training LMS)`),` | Email From display name |
| `apps/api/src/services/newsfeed/newsfeed.ts` | 418 | `const orgName = feedData.organization?.name || 'Integer Training LMS';` | UI copy / fallback string |
| `apps/api/src/services/newsfeed/newsfeed.ts` | 443 | `from: buildEmailFromName(`${orgName} - Integer Training LMS`),` | Email From display name |
| `apps/api/src/services/newsfeed/newsfeed.ts` | 469 | `const orgName = feedData.organization?.name || 'Integer Training LMS';` | UI copy / fallback string |
| `apps/api/src/services/newsfeed/newsfeed.ts` | 487 | `from: buildEmailFromName(`${orgName} - Integer Training LMS`),` | Email From display name |
| `apps/api/src/services/organization/audience.ts` | 225 | `from: buildEmailFromName(`${organization.name} (via Integer Training LMS)`),` | Email From display name |
| `apps/api/src/services/organization/audience.ts` | 313 | `from: buildEmailFromName(`${organization.name} (via Integer Training LMS)`),` | Email From display name |
| `apps/api/src/services/organization/audience.ts` | 423 | `from: buildEmailFromName(`${organization.name} (via Integer Training LMS)`),` | Email From display name |
| `apps/api/src/services/organization/audience.ts` | 716 | `from: buildEmailFromName(`${organization.name} (via Integer Training LMS)`),` | Email From display name |
| `apps/api/src/services/organization/invite.ts` | 271 | `from: buildEmailFromName(`${organization.name} (via Integer Training LMS)`),` | Email From display name |
| `apps/api/src/services/organization/invite.ts` | 272 | `subject: sanitizeEmailSubject(`You have been invited to join ${organization.name} on Integer Training LMS`),` | UI copy / fallback string |
| `apps/api/src/services/submission/submission.ts` | 964 | `const orgName = orgResult?.orgName || 'Integer Training LMS';` | UI copy / fallback string |
| `apps/api/src/services/submission/submission.ts` | 1000 | `from: buildEmailFromName(`${orgName} (via Integer Training LMS)`),` | Email From display name |
| `apps/api/src/services/submission/submission.ts` | 1045 | `const orgName = orgResult?.orgName || 'Integer Training LMS';` | UI copy / fallback string |
| `apps/api/src/services/submission/submission.ts` | 1075 | `from: buildEmailFromName(`${orgName} (via Integer Training LMS)`),` | Email From display name |
| `apps/api/src/utils/course-completion.ts` | 91 | `from: buildEmailFromName(`${courseRow.orgName} (via Integer Training LMS)`),` | Email From display name |
| `apps/api/src/utils/org-site-og.ts` | 159 | `? `<div class="watermark">Powered by <strong>Integer Training LMS</strong></div>`` | UI copy / fallback string |
| `apps/dashboard/src/error.html` | 3 | `<img src="/logo-512.png" class="logo" alt="Integer Training LMS - Logo" />` | UI copy / fallback string |
| `apps/dashboard/src/lib/components/Navigation/app.svelte` | 41 | `{isCoursePage ? title : 'Integer Training LMS'}` | UI copy / fallback string |
| `apps/dashboard/src/lib/components/Navigation/Logo.svelte` | 16 | `title={`${$t('navigation.goto')} ${orgName || 'Integer Training LMS'} ${$t('navigation.home')}`}` | UI copy / fallback string |
| `apps/dashboard/src/lib/components/Navigation/Logo.svelte` | 23 | `alt={`${orgName || 'Integer Training LMS'} logo`}` | UI copy / fallback string |
| `apps/dashboard/src/lib/features/automation/utils/automation-utils.ts` | 160 | `return 'Integer Training LMS MCP';` | UI copy / fallback string |
| `apps/dashboard/src/lib/features/automation/utils/automation-utils.ts` | 162 | `return 'Integer Training LMS API';` | UI copy / fallback string |
| `apps/dashboard/src/lib/features/automation/utils/automation-utils.ts` | 164 | `return 'Integer Training LMS Zapier';` | UI copy / fallback string |
| `apps/dashboard/src/lib/features/onboarding/components/welcome-modal.svelte` | 43 | `>Integer Training LMS</a` | UI copy / fallback string |
| `apps/dashboard/src/lib/features/org/components/quiz/new-quiz-modal.svelte` | 95 | `<title>{$t('components.quiz.title')} - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/lib/features/ui/auth-ui.svelte` | 58 | `alt={$currentOrg.name ? $currentOrg.name : 'Integer Training LMS'}` | UI copy / fallback string |
| `apps/dashboard/src/lib/features/ui/auth-ui.svelte` | 60 | `<Avatar.Fallback>{$currentOrg.name ? $currentOrg.name : 'Integer Training LMS'}</Avatar.Fallback>` | UI copy / fallback string |
| `apps/dashboard/src/lib/features/ui/media-player/players/plyr-player.svelte` | 176 | `<img src="/logo-192.png" alt="Integer Training LMS" class="h-7 w-7 rounded-sm bg-white/90 p-0.5 shadow-sm" />` | UI copy / fallback string |
| `apps/dashboard/src/lib/features/ui/powered-by.svelte` | 66 | `{$t('course.navItem.landing_page.powered_by')} Integer Training LMS` | UI copy / fallback string |
| `apps/dashboard/src/lib/features/ui/text-editor.svelte` | 47 | `placeholder = 'Welcome to Integer Training LMS',` | UI copy / fallback string |
| `apps/dashboard/src/lib/utils/functions/metaTags.server.ts` | 10 | `const DEFAULT_TITLE = 'Integer Training LMS';` | UI copy / fallback string |
| `apps/dashboard/src/lib/utils/functions/metaTags.server.ts` | 107 | `'Integer Training LMS';` | UI copy / fallback string |
| `apps/dashboard/src/lib/utils/translations/en.json` | 222 | `"brand": "Integer Training LMS"` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 420 | `"page_subtitle": "Your name, email, and how you appear wherever you work in Integer Training LMS.",` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 446 | `"personal_page_subtitle": "Choose which email notifications you receive from Integer Training LMS.",` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 748 | `"by_classroomio": "by Integer Training LMS",` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 1017 | `"step_authenticate": "Step 1: Authenticate your account via the Integer Training LMS bot.",` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 1025 | `"page_subtitle": "Your plan, billing portal, and how you pay for Integer Training LMS.",` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 1096 | `"page_title": "Media Manager - Integer Training LMS",` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 1249 | `"page_title": "Tags - Integer Training LMS",` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 1300 | `"page_title": "Courses - Integer Training LMS",` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 1644 | `"classroomio_home": "Integer Training LMS Home",` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 1650 | `"goto_home": "Go to Integer Training LMS Home",` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 1949 | `"placeholder": "Ask Integer Training LMS to create a course for you...",` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 3324 | `"classroomio_brand": "Integer Training LMS",` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 4030 | `"page_subtitle": "Connect AI tools to Integer Training LMS with org-scoped keys you can rotate anytime.",` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 4044 | `"description": "These keys authenticate the current organization when an MCP client calls Integer Training LMS` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 4051 | `"name_placeholder": "Integer Training LMS OpenCode",` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 4060 | `"codex_description": "Adds the Integer Training LMS MCP server to Codex with the same org-scoped key.",` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 4066 | `"subtitle": "Manage API keys to integrate with the Integer Training LMS public API.",` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 4069 | `"description": "These keys authenticate the current organization when calling the Integer Training LMS public ` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 4073 | `"empty_description": "Create the first org-scoped API key to use the Integer Training LMS public API.",` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 4090 | `"page_subtitle": "Automate Integer Training LMS with thousands of apps through Zapier. Coming soon."` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 4450 | `"page_title": "Join {orgName} on Integer Training LMS",` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 4469 | `"page_title": "Join {orgName} on Integer Training LMS",` | UI copy (i18n value) |
| `apps/dashboard/src/routes/(app)/cohorts/[id]/+layout.svelte` | 35 | `<title>{cohortApi.cohort?.name || 'Cohort'} - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/courses/[id]/+layout.svelte` | 169 | `<title>{courseApi.course?.title || 'Integer Training LMS Course'}</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/lms/certificates/+page.svelte` | 8 | `<title>Certificates - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/lms/cohorts/+page.svelte` | 31 | `<title>{$t('lms_navigation.cohorts') || 'Cohorts'} - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/lms/community/+page.svelte` | 9 | `<title>Community - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/lms/community/ask/+page.svelte` | 13 | `<title>Ask the Community - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/lms/community/[slug]/+page.svelte` | 12 | `<title>Question - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/lms/explore/+page.svelte` | 8 | `<title>Explore - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/lms/mylearning/+page.svelte` | 8 | `<title>My Learning - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/lms/settings/+page.svelte` | 25 | `<title>Settings - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/lms/settings/integrations/+page.svelte` | 8 | `<title>Integrations - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/lms/settings/notifications/+page.svelte` | 25 | `<title>{t.get('settings.notifications.page_title')} - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/+page.svelte` | 190 | `<title>Home - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/analytics/+page.svelte` | 39 | `<title>{$t('analytics.title')} - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/api/+page.svelte` | 19 | `<title>{t.get('automation.tabs.api')} - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/audience/+page.svelte` | 25 | `<title>Audience - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/audience/import/+page.svelte` | 16 | `<title>{$t('audience.import.title')} - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/audience/[...params]/+page.svelte` | 12 | `<title>{t.get('audience.user_analytics.title')} - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/cohorts/+page.svelte` | 97 | `<title>{$t('cohorts.page_title') || 'Cohorts'} - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/community/+page.svelte` | 11 | `<title>Community - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/community/ask/+page.svelte` | 13 | `<title>Ask the Community - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/community/[cslug]/+page.svelte` | 12 | `<title>Question - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/compliance/+page.svelte` | 43 | `<title>{$t('compliance.title')} - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/courses/+page.svelte` | 213 | `<title>Courses - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/mcp/+page.svelte` | 18 | `<title>{t.get('automation.tabs.mcp')} - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/quiz/+page.svelte` | 10 | `<title>Interactive Quizzes - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/settings/+page.svelte` | 26 | `<title>Settings - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/settings/ai-credits/+page.svelte` | 8 | `<title>AI Credits - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/settings/ai-tutor/+page.svelte` | 6 | `<title>AI Tutor Settings - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/settings/auth/+page.svelte` | 8 | `<title>{t.get('settings.auth.title')} - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/settings/auth/sso/+page.svelte` | 8 | `<title>{t.get('settings.auth.tabs.sso')} - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/settings/auth/token-auth/+page.svelte` | 8 | `<title>{t.get('settings.auth.tabs.token_auth')} - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/settings/billing/+page.svelte` | 8 | `<title>Billing - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/settings/customize-lms/+page.svelte` | 25 | `<title>Customize LMS - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/settings/domains/+page.svelte` | 6 | `<title>Custom domain - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/settings/integrations/+page.svelte` | 8 | `<title>Integrations - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/settings/landingpage/+page.svelte` | 9 | `<title>Landing Page Settings - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/settings/landingpage/edit/+page.svelte` | 133 | `<title>Landing Page Editor - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/settings/notifications/+page.svelte` | 25 | `<title>{t.get('settings.notifications.page_title')} - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/settings/org/+page.svelte` | 25 | `<title>Organization Settings - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/settings/teams/+page.svelte` | 6 | `<title>Teams - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/settings/workspaces/+page.svelte` | 9 | `<title>{$t('account.workspaces.page_title')} - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/setup/+page.svelte` | 122 | `<title>Setup - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/teams-overview/+page.svelte` | 49 | `<title>{$t('cohorts.goals.heading')} · Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/widgets/+page.svelte` | 37 | `<title>{$t('widgets.heading')} - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/zapier/+page.svelte` | 8 | `<title>{t.get('automation.tabs.zapier')} - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(auth)/auth-failed/+page.svelte` | 17 | `<title>Reset Password - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(auth)/auth-failed/+page.svelte` | 25 | `alt={$currentOrg.name ? $currentOrg.name : 'Integer Training LMS'}` | UI copy / fallback string |
| `apps/dashboard/src/routes/(auth)/auth-failed/+page.svelte` | 27 | `<Avatar.Fallback>{$currentOrg.name ? $currentOrg.name : 'Integer Training LMS'}</Avatar.Fallback>` | UI copy / fallback string |
| `apps/dashboard/src/routes/(auth)/forgot/+page.svelte` | 17 | `<title>Forgot Password - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(auth)/login/+page.svelte` | 127 | `<title>Welcome back to {$currentOrg.name || 'Integer Training LMS'}</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(auth)/onboarding/+page.svelte` | 60 | `<img src="/logo-192.png" alt="Integer Training LMS logo" height="50" width="50" data-atf="1" />` | UI copy / fallback string |
| `apps/dashboard/src/routes/(auth)/onboarding/+page.svelte` | 61 | `<h4 class="text-xl dark:text-white">Integer Training LMS</h4>` | UI copy / fallback string |
| `apps/dashboard/src/routes/(auth)/reset/+page.svelte` | 51 | `<title>Reset Password - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(auth)/signup/+page.svelte` | 177 | `<title>Join Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(auth)/verify-email-error/+page.svelte` | 50 | `<title>Email Verification Error - Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(org-site)/course/[slug]/+page.svelte` | 9 | `const orgName = $derived(data.org?.name ?? data.course?.org?.name ?? 'Integer Training LMS');` | UI copy / fallback string |
| `apps/dashboard/src/routes/(org-site)/course/[slug]/enroll/+page.svelte` | 234 | `<title>Join {data.course?.title ?? 'Course'} on Integer Training LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/+page.svelte` | 23 | `: 'Integer Training LMS - One Platform for Customer, Partner, and Employee Training'` | UI copy / fallback string |
| `apps/jobs/src/processors/notifications/notify-session-update.ts` | 49 | `const orgName = orgData.orgName || 'Integer Training LMS';` | UI copy / fallback string |
| `apps/jobs/src/processors/notifications/notify-session-update.ts` | 107 | `from: buildEmailFromName(`${orgName} (via Integer Training LMS)`),` | Email From display name |
| `apps/jobs/src/processors/notifications/session-reminder-scan.ts` | 100 | `from: buildEmailFromName(`${row.organizationName} (via Integer Training LMS)`),` | Email From display name |
| `packages/email/src/emails/forgot-password.ts` | 8 | `subject: 'Password reset notification - Integer Training LMS',` | Email copy (visible in inbox) |
| `packages/email/src/emails/forgot-password.ts` | 16 | `<p>You are receiving this email because you have requested a password reset for your Integer Training LMS acco` | Email copy (visible in inbox) |
| `packages/email/src/emails/invite-teacher.ts` | 10 | `subject: 'You have been invited to join an organization on Integer Training LMS',` | Email copy (visible in inbox) |
| `packages/email/src/emails/invite-teacher.ts` | 29 | `? `<p><strong>${inviterName}</strong> invited you to join <strong>${orgName}</strong> on Integer Training LMS ` | Email copy (visible in inbox) |
| `packages/email/src/emails/invite-teacher.ts` | 30 | `: `<p>You have been invited to join <strong>${orgName}</strong> on Integer Training LMS as ${roleName}.</p>`;` | Email copy (visible in inbox) |
| `packages/email/src/emails/on-password-reset.ts` | 8 | `subject: 'Password Reset Successful - Integer Training LMS',` | Email copy (visible in inbox) |
| `packages/email/src/emails/welcome.ts` | 8 | `subject: 'Welcome to Integer Training LMS!',` | Email copy (visible in inbox) |
| `packages/email/src/emails/welcome.ts` | 15 | `<p>My name is Best, the founder of Integer Training LMS. I saw you signed up, any questions so far?</p>` | Email copy (visible in inbox) |
| `packages/email/src/templates/default.ts` | 38 | `<img src="${CLASSROOMIO_LOGO}" alt="Integer Training LMS" width="130" style="width:130px;height:auto;display:b` | Email copy (visible in inbox) |
| `packages/email/src/templates/default.ts` | 163 | `Integer Training LMS ${new Date().getFullYear()}. All rights reserved.` | Email copy (visible in inbox) |
| `packages/email/src/utils/constants.ts` | 38 | `const DEFAULT_EMAIL_FROM = '"Best from Integer Training LMS" <notify@mail.classroomio.com>';` | Email copy (visible in inbox) |
| `packages/email/src/utils/constants.ts` | 39 | `const DEFAULT_EMAIL_REPLY_TO = '"Best from Integer Training LMS" <help@classroomio.com>';` | Email copy (visible in inbox) |
| `packages/email/tests/email-helpers.test.ts` | 10 | `const DEFAULT_FROM = '"Best from Integer Training LMS" <notify@mail.classroomio.com>';` | UI copy / fallback string |


##### B. "Pearl LMS" / "Pearl" user-visible strings (apps/ + packages/, excluding code comments)

| file | line | string | type |
|---|---|---|---|
| `apps/api/.env.example` | 36 | `SMTP_SENDER=""                                 # e.g. '"Pearl LMS" <noreply@yourdomain>'` | Env example |
| `apps/api/.env.example` | 37 | `SMTP_REPLY_TO=""                               # e.g. '"Pearl LMS Support" <support@yourdomain>'` | Env example |
| `apps/api/src/__tests__/config/trusted-origin-selfhosted.test.ts` | 11 | `const EXPLICIT = 'https://learn.epearlacademy.com';` | Test fixture (rename optional) |
| `apps/dashboard/src/lib/features/admin-dashboard/pages/admin-dashboard.svelte` | 45 | `<title>Admin Dashboard — Pearl LMS</title>` | Meta (page title) |
| `apps/dashboard/src/lib/features/announcements/components/broadcast-banner.svelte` | 11 | `const STORAGE_KEY = 'pearl.dismissedBroadcasts';` | localStorage key (internal; harmless to keep, renaming resets users' dismissals) |
| `apps/dashboard/src/lib/features/caseload/pages/progression.svelte` | 216 | `<title>Learner Progression — Pearl LMS</title>` | Meta (page title) |
| `apps/dashboard/src/lib/features/learner-progressions/pages/learner-progressions.svelte` | 240 | `<title>Learner Progressions — Pearl LMS</title>` | Meta (page title) |
| `apps/dashboard/src/lib/features/lms/components/tutor-feedback-dialog.svelte` | 56 | `Your feedback helps us support you better. It is private — only the Pearl admin team sees it, never your tut` | UI copy |
| `apps/dashboard/src/routes/(app)/caseload/+page.svelte` | 6 | `<title>Caseload — Pearl LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/caseload/courses/+page.svelte` | 24 | `<title>My courses — Pearl LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/caseload/courses/[courseId]/+page.svelte` | 31 | `<title>{content?.title ?? 'Course'} — Pearl LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/caseload/courses/[courseId]/submissions/+page.svelte` | 164 | `<title>{grid?.assessmentName ?? 'Submissions'} — Pearl LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/caseload/courses/[courseId]/units/[lessonId]/+page.svelte` | 101 | `<title>{unit?.title ?? 'Unit'} — Pearl LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/caseload/progression/+page.svelte` | 6 | `<title>Learner Progression — Pearl LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/caseload/[learnerId]/+page.svelte` | 11 | `<title>Learner — Pearl LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/lms/+layout.svelte` | 20 | `const COUNT_KEY = 'pearl.tutorFeedback.shows.v1'; // { [milestone]: timesShown }` | localStorage key (internal; harmless to keep, renaming resets users' dismissals) |
| `apps/dashboard/src/routes/(app)/lms/+layout.svelte` | 21 | `const SESSION_KEY = 'pearl.tutorFeedback.shownMilestone'; // milestone already shown this login` | localStorage key (internal; harmless to keep, renaming resets users' dismissals) |
| `apps/dashboard/src/routes/(app)/org/[slug]/allocation/+page.svelte` | 6 | `<title>Tutor allocation — Pearl LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/org/[slug]/users/+page.svelte` | 6 | `<title>Users — Pearl LMS</title>` | Meta (page title) |
| `apps/dashboard/src/routes/(app)/welcome/+page.svelte` | 30 | `<title>Welcome — Pearl LMS</title>` | Meta (page title) |
| `apps/jobs/.env.example` | 53 | `SMTP_SENDER=""                                 # e.g. '"Pearl LMS" <noreply@yourdomain>'` | Env example |
| `apps/jobs/.env.example` | 54 | `SMTP_REPLY_TO=""                               # e.g. '"Pearl LMS Support" <support@yourdomain>'` | Env example |
| `packages/db/src/scripts/seed-fixtures.ts` | 32 | `const email = `${f.key}@pearl.fixture`;` | Example/test/seed value |
| `packages/email/src/config/env.ts` | 8 | `// Reply-To identity for outbound mail, e.g. '"Pearl LMS" <support@pearl.example>'.` | Example/test/seed value |
| `packages/email/tests/sender-identity.test.ts` | 25 | `SMTP_SENDER: '"Pearl LMS" <noreply@pearl.example>',` | Test fixture (rename optional) |
| `packages/email/tests/sender-identity.test.ts` | 26 | `SMTP_REPLY_TO: '"Pearl LMS Support" <support@pearl.example>'` | Test fixture (rename optional) |
| `packages/email/tests/sender-identity.test.ts` | 28 | `expect(EMAIL_FROM).toBe('"Pearl LMS" <noreply@pearl.example>');` | Test fixture (rename optional) |
| `packages/email/tests/sender-identity.test.ts` | 29 | `expect(EMAIL_REPLY_TO).toBe('"Pearl LMS Support" <support@pearl.example>');` | Test fixture (rename optional) |


##### C. Residual ClassroomIO / classroomio.com / clsrio.com strings (deployed apps + packages; excludes the `classroomio` API-client variable, `@cio/*` imports, code comments)

| file | line | string | type |
|---|---|---|---|
| `apps/dashboard/src/error.html` | 9 | `<a href="mailto:support@classroomio.com">Contact Us</a>` | Email address / sender - REPLACE |
| `apps/dashboard/src/lib/features/app/layout-setup.ts` | 103 | `const notCustomDomainHosts = [env.PRIVATE_APP_HOST || '', 'classroomio.com', 'myclassroomio.com'].filter(Boolean);` | Allow-list/code logic (vendor hosts) - leave or prune |
| `apps/dashboard/src/lib/features/audience/pages/user-analytics.svelte` | 122 | `src={course.logo || '/images/classroomio-course-img-template.jpg'}` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/features/automation/utils/automation-utils.ts` | 7 | `return 'npx -y @classroomio/mcp';` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/automation/utils/automation-utils.ts` | 104 | `"args": ["-y", "@classroomio/mcp"],` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/automation/utils/automation-utils.ts` | 106 | `"CLASSROOMIO_API_URL": "https://api.classroomio.com",` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/automation/utils/automation-utils.ts` | 107 | `"CLASSROOMIO_API_KEY": "${apiKey}"` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/automation/utils/automation-utils.ts` | 116 | `--env CLASSROOMIO_API_URL=https://api.classroomio.com \\` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/automation/utils/automation-utils.ts` | 117 | `--env CLASSROOMIO_API_KEY=${apiKey} \\` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/automation/utils/automation-utils.ts` | 118 | `-- npx -y @classroomio/mcp`;` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/automation/utils/automation-utils.ts` | 129 | `"command": ["npx", "-y", "@classroomio/mcp"],` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/automation/utils/automation-utils.ts` | 132 | `"CLASSROOMIO_API_URL": "https://api.classroomio.com",` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/automation/utils/automation-utils.ts` | 133 | `"CLASSROOMIO_API_KEY": "${apiKey}"` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/automation/utils/automation-utils.ts` | 147 | `"args": ["-y", "@classroomio/mcp"],` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/automation/utils/automation-utils.ts` | 149 | `"CLASSROOMIO_API_URL": "https://api.classroomio.com",` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/automation/utils/automation-utils.ts` | 150 | `"CLASSROOMIO_API_KEY": "${apiKey}"` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/community/api/community.svelte.ts` | 75 | `await this.execute<typeof classroomio.community.$get>({` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/community/api/community.svelte.ts` | 76 | `requestFn: () => classroomio.community.$get({ query: { orgId } }),` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/community/api/community.svelte.ts` | 94 | `await this.execute<(typeof classroomio.community)[':slug']['$get']>({` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/community/api/community.svelte.ts` | 95 | `requestFn: () => classroomio.community[':slug'].$get({ param: { slug } }),` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/community/api/community.svelte.ts` | 135 | `classroomio.community.$post({` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/community/api/community.svelte.ts` | 200 | `classroomio.community[':id'].comment.$post({` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/community/api/community.svelte.ts` | 250 | `classroomio.community[':id'].upvote.$post({` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/community/api/community.svelte.ts` | 300 | `classroomio.community[':id'].$put({` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/community/api/community.svelte.ts` | 369 | `await this.execute<(typeof classroomio.community)[':id']['$delete']>({` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/community/api/community.svelte.ts` | 370 | `requestFn: () => classroomio.community[':id'].$delete({ param: { id: questionId } }),` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/community/api/community.svelte.ts` | 397 | `await this.execute<(typeof classroomio.community)[':id']['comment']['$delete']>({` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/community/api/community.svelte.ts` | 399 | `classroomio.community[':id'].comment.$delete({` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/community/utils/types.ts` | 3 | `export type GetCommunityQuestionsRequest = typeof classroomio.community.$get;` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/community/utils/types.ts` | 8 | `export type GetCommunityQuestionRequest = (typeof classroomio.community)[':slug']['$get'];` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/community/utils/types.ts` | 12 | `export type CreateCommentRequest = typeof classroomio.community.$post;` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/community/utils/types.ts` | 16 | `export type UpvotePostRequest = (typeof classroomio.community)[':id']['upvote']['$post'];` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/community/utils/types.ts` | 20 | `export type CreateCommunityQuestionRequest = typeof classroomio.community.$post;` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/community/utils/types.ts` | 25 | `export type UpdateQuestionRequest = (typeof classroomio.community)[':id']['$put'];` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/course/components/course-list-row.svelte` | 78 | `const bannerImage = $derived(logo?.trim() ? logo : '/images/classroomio-course-img-template.jpg');` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/features/course/components/view-as-student-modal.svelte` | 50 | `src="https://assets.cdn.clsrio.com/cio-lms-plain.png"` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/features/course/pages/settings.svelte` | 473 | `src={$settings.logo ? $settings.logo : '/images/classroomio-course-img-template.jpg'}` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/features/course/pages/settings.svelte` | 551 | `href="https://classroomio.com/docs/guides/course-types"` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/lms/components/learning.svelte` | 67 | `src={course.logo || '/images/classroomio-course-img-template.jpg'}` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/features/onboarding/components/welcome-modal.svelte` | 42 | `<a href="https://app.classroomio.com/" class="ui:text-primary no-underline hover:no-underline"` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/org/components/quiz/play/connect-to-play.svelte` | 40 | `<h3>play.classroomio.com</h3>` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/settings/components/auth-token-auth.svelte` | 56 | `const baseUrl = 'https://api.classroomio.dev';` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/settings/pages/customize-lms.svelte` | 156 | `: '/images/classroomio-course-img-template.jpg'}` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/features/settings/pages/integrations.svelte` | 59 | `<Button variant="outline" onclick={() => window.open('https://t.me/classroomio_bot', '_blank')}>` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/settings/pages/landingpage.svelte` | 52 | `const CDN_BASE = 'https://assets.cdn.clsrio.com/templates';` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/features/settings/pages/token-auth.svelte` | 48 | `const baseUrl = 'https://api.classroomio.dev';` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/ui/media-player/players/muse-player.svelte` | 13 | `? `https://muse.ai/embed/${svid}?logo=https://app.classroomio.com/logo-512.png&subtitles=auto&cover_play_position=center` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/features/ui/page-restricted.svelte` | 16 | `<Button href="https://classroomio.com">Go Home</Button>` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/ui/powered-by.svelte` | 48 | `href={`https://classroomio.com?utm_source=${$currentOrg.siteName}.${TENANT_ROOT_DOMAIN}`}` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/ui/sidebar/footer/menu.svelte` | 27 | `const SUPPORT_EMAIL = 'help@classroomio.com';` | Email address / sender - REPLACE |
| `apps/dashboard/src/lib/features/ui/sidebar/footer/menu.svelte` | 28 | `const DOCS_URL = 'https://classroomio.com/docs';` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/ui/upgrade-modal.svelte` | 85 | `window.open('https://classroomio.com/blog/early-adopter', '_blank');` | User-visible URL / copy |
| `apps/dashboard/src/lib/features/widget/utils/layout-thumbnail.ts` | 4 | `export const WIDGET_LAYOUT_THUMBNAIL_BASE = 'https://assets.cdn.clsrio.com/templates/widget-layouts';` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/utils/constants/quiz.ts` | 3 | `card: 'https://pgrest.classroomio.com/storage/v1/object/public/avatars/quizes/standard-quiz-card.svg',` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/utils/constants/quiz.ts` | 4 | `editor: 'https://pgrest.classroomio.com/storage/v1/object/public/avatars/quizes/standard-quiz-editor.svg',` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/utils/constants/quiz.ts` | 5 | `play: 'https://pgrest.classroomio.com/storage/v1/object/public/avatars/quizes/standard-quiz-play.svg'` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/utils/constants/quiz.ts` | 8 | `card: 'https://pgrest.classroomio.com/storage/v1/object/public/avatars/quizes/mainstream-quiz-card.svg',` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/utils/constants/quiz.ts` | 9 | `editor: 'https://pgrest.classroomio.com/storage/v1/object/public/avatars/quizes/mainstream-quiz-editor.svg',` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/utils/constants/quiz.ts` | 10 | `play: 'https://pgrest.classroomio.com/storage/v1/object/public/avatars/quizes/mainstream-quiz-play.svg'` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/utils/constants/quiz.ts` | 21 | `circle: 'https://pgrest.classroomio.com/storage/v1/object/public/avatars/quizes/circle.svg',` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/utils/constants/quiz.ts` | 22 | `spade: 'https://pgrest.classroomio.com/storage/v1/object/public/avatars/quizes/spade.svg',` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/utils/constants/quiz.ts` | 23 | `square: 'https://pgrest.classroomio.com/storage/v1/object/public/avatars/quizes/square.svg',` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/utils/constants/quiz.ts` | 24 | `pentagon: 'https://pgrest.classroomio.com/storage/v1/object/public/avatars/quizes/pentagon.svg',` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/utils/constants/quiz.ts` | 25 | `hexagon: 'https://pgrest.classroomio.com/storage/v1/object/public/avatars/quizes/hexagon.svg',` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/utils/constants/quiz.ts` | 26 | `triangle: 'https://pgrest.classroomio.com/storage/v1/object/public/avatars/quizes/triangle.svg'` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/utils/constants/quiz.ts` | 65 | `image: 'https://pgrest.classroomio.com/storage/v1/object/public/avatars/quizes/triangle.svg'` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/utils/constants/quiz.ts` | 70 | `image: 'https://pgrest.classroomio.com/storage/v1/object/public/avatars/quizes/square.svg'` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/utils/csp-domains.js` | 7 | `'https://assets.cdn.clsrio.com',` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/utils/csp-domains.js` | 8 | `'https://embed.classroomio.com',` | User-visible URL / copy |
| `apps/dashboard/src/lib/utils/csp-domains.js` | 21 | `'https://assets.cdn.clsrio.com/eqneditor_1.css',` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/utils/csp-domains.js` | 25 | `'https://*.classroomio.com',` | Allow-list/code logic (vendor hosts) - leave or prune |
| `apps/dashboard/src/lib/utils/csp-domains.js` | 26 | `'https://classroomio.com',` | User-visible URL / copy |
| `apps/dashboard/src/lib/utils/csp-domains.js` | 27 | `'https://app.classroomio.com',` | User-visible URL / copy |
| `apps/dashboard/src/lib/utils/csp-domains.js` | 28 | `'https://api.classroomio.com',` | User-visible URL / copy |
| `apps/dashboard/src/lib/utils/csp-domains.js` | 29 | `'https://pgrest.classroomio.com',` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/utils/csp-domains.js` | 30 | `'https://play.classroomio.com',` | User-visible URL / copy |
| `apps/dashboard/src/lib/utils/csp-domains.js` | 31 | `'wss://*.classroomio.com',` | Allow-list/code logic (vendor hosts) - leave or prune |
| `apps/dashboard/src/lib/utils/csp-domains.js` | 32 | `'https://assets.cdn.clsrio.com',` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/utils/functions/cookies.ts` | 10 | `.filter((c) => c.name.includes('classroomio'))` | INTERNAL identifier (cookie/localStorage key) - do NOT rename casually |
| `apps/dashboard/src/lib/utils/functions/cookies.ts` | 16 | `const cioCookies = cookies.getAll().filter((c) => c.name.includes('classroomio'));` | INTERNAL identifier (cookie/localStorage key) - do NOT rename casually |
| `apps/dashboard/src/lib/utils/functions/org-site-og-url.ts` | 3 | `const DEFAULT_CLOUD_MEDIA_CDN_URL = 'https://img.cdn.clsrio.com';` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/dashboard/src/lib/utils/functions/org-site-og-url.ts` | 92 | `return buildOrgSiteOgApiUrl(siteName, 'https://api.classroomio.com');` | User-visible URL / copy |
| `apps/dashboard/src/lib/utils/translations/en.json` | 1570 | `"show_powered_by": "Show Classroomio branding",` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 1704 | `"custom_domain_not_classroomio": "Domain cannot contain 'classroomio'",` | UI copy (i18n value) |
| `apps/dashboard/src/lib/utils/translations/en.json` | 4059 | `"claude_code_description": "Registers `@classroomio/mcp` with Claude Code using the generated org-scoped key.",` | UI copy (i18n value) |
| `apps/dashboard/src/routes/(app)/org/[slug]/api/+page.svelte` | 29 | `<Button variant="outline" onclick={() => window.open('https://classroomio.com/docs/api', '_blank')}>` | User-visible URL / copy |
| `apps/dashboard/src/routes/(app)/org/[slug]/community/+page.server.ts` | 15 | `classroomio.community.$get({ query: { orgId } }, getApiHeaders(cookies, orgId))` | User-visible URL / copy |
| `apps/dashboard/src/routes/(app)/org/[slug]/community/[cslug]/+page.server.ts` | 10 | `classroomio.community[':slug'].$get({ param: { slug } }, getApiHeaders(cookies, orgId))` | User-visible URL / copy |
| `apps/dashboard/src/routes/(auth)/onboarding/+page.svelte` | 102 | `suffix=".classroomio.com"` | User-visible URL / copy |
| `apps/dashboard/src/routes/(auth)/verify-email-error/+page.svelte` | 45 | `window.open('mailto:help@classroomio.com?subject=Email Verification Issue&body=Error Type: ' + type, '_blank');` | Email address / sender - REPLACE |
| `apps/dashboard/src/routes/(org-site)/course/[slug]/+page.server.ts` | 88 | `handle: '@classroomio',` | User-visible URL / copy |
| `apps/dashboard/src/routes/(org-site)/course/[slug]/+page.server.ts` | 89 | `site: '@classroomio',` | User-visible URL / copy |
| `apps/dashboard/src/routes/(org-site)/course/[slug]/lesson/[itemSlug]/+page.server.ts` | 61 | `handle: '@classroomio',` | User-visible URL / copy |
| `apps/dashboard/src/routes/(org-site)/course/[slug]/lesson/[itemSlug]/+page.server.ts` | 62 | `site: '@classroomio',` | User-visible URL / copy |
| `apps/dashboard/src/routes/+error.svelte` | 14 | `window.location.href = 'https://classroomio.com';` | User-visible URL / copy |
| `apps/dashboard/src/routes/+error.svelte` | 54 | `<Button href="https://classroomio.com/tools" variant="secondary">` | User-visible URL / copy |
| `apps/dashboard/src/routes/+page.svelte` | 82 | `<Button variant="default" href="https://classroomio.com/contact">Contact Us</Button>` | User-visible URL / copy |
| `apps/dashboard/src/routes/404/+page.svelte` | 11 | `window.location.href = isOrg ? 'https://classroomio.com' : '/';` | User-visible URL / copy |
| `apps/dashboard/static/manifest.json` | 4 | `"name": "ClassroomIO",` | PWA manifest (user-visible) |
| `apps/dashboard/static/manifest.json` | 5 | `"short_name": "ClassroomIO",` | PWA manifest (user-visible) |
| `apps/api/src/app.ts` | 163 | `message: `"Welcome to Classroomio.com API - docs are at ${API_SERVER_URL}/docs"`` | User-visible URL / copy |
| `apps/api/src/constants/index.ts` | 9 | `: ['http://localhost:5173', 'http://localhost:5180', 'https://*.classroomio.com', 'https://*.myclassroomio.com'];` | Allow-list/code logic (vendor hosts) - leave or prune |
| `apps/api/src/services/course/session-invite.ts` | 24 | `uid: `session-${upcoming.lessonId}@classroomio`,` | INTERNAL (iCalendar UID suffix) - leave |
| `apps/api/src/services/newsfeed/newsfeed.ts` | 444 | `replyTo: feedData.author?.email || 'noreply@classroomio.com',` | Email address / sender - REPLACE |
| `apps/api/src/services/newsfeed/newsfeed.ts` | 488 | `replyTo: 'noreply@classroomio.com',` | Email address / sender - REPLACE |
| `apps/api/src/services/org/domain.ts` | 204 | `if (domain.includes('classroomio.com') || domain.includes('myclassroomio.com')) {` | User-visible URL / copy |
| `apps/api/src/services/org/domain.ts` | 205 | `throw new AppError("Domain cannot contain 'classroomio'", ErrorCodes.VALIDATION_ERROR, 400, 'domain');` | INTERNAL identifier (widget theme preset enum) - leave |
| `apps/api/src/services/org/og.ts` | 12 | `const DEFAULT_OG_IMAGE = 'https://brand.cdn.clsrio.com/og/classroomio-opengraph.jpg';` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `apps/api/src/services/widget-payload.ts` | 21 | `const DEFAULT_WIDGET_APP_BASE_URL = 'https://classroomio.com';` | User-visible URL / copy |
| `apps/api/src/services/widget-payload.ts` | 272 | `planGatedFields: resolveWidgetPlanGatedFields(activePlan?.planName, 'classroomio'),` | INTERNAL identifier (widget theme preset enum) - leave |
| `apps/jobs/src/processors/notifications/notify-session-update.ts` | 59 | `uid: `session-${lesson.id}@classroomio`,` | INTERNAL (iCalendar UID suffix) - leave |
| `apps/jobs/src/processors/notifications/session-reminder-scan.ts` | 63 | `uid: `session-${row.lessonId}@classroomio`,` | INTERNAL (iCalendar UID suffix) - leave |
| `packages/email/src/emails/forgot-password.ts` | 23 | `<p>PS: If you did not initiate this request, reply to this email or write to help@classroomio.com so we can look into a ` | User-visible URL / copy |
| `packages/email/src/emails/welcome.ts` | 23 | `<a class="button" href="https://classroomio.com/demo">Book demo</a>` | User-visible URL / copy |
| `packages/email/src/ics.ts` | 62 | `'PRODID:-//ClassroomIO//Live Session//EN',` | User-visible URL / copy |
| `packages/email/src/templates/default.ts` | 4 | `const CLASSROOMIO_LOGO = 'https://brand.cdn.clsrio.com/cio-bg-transparent.png';` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `packages/email/src/templates/default.ts` | 37 | `return `<a href="https://classroomio.com" target="_blank">` | User-visible URL / copy |
| `packages/email/src/templates/default.ts` | 38 | `<img src="${CLASSROOMIO_LOGO}" alt="Integer Training LMS" width="130" style="width:130px;height:auto;display:block;" />` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `packages/email/src/templates/default.ts` | 165 | `<a href="https://classroomio.com" style="color:#94a3b8;text-decoration:none;">Website</a>` | User-visible URL / copy |
| `packages/email/src/templates/default.ts` | 167 | `<a href="https://classroomio.com/tos" style="color:#94a3b8;text-decoration:none;">Terms</a>` | User-visible URL / copy |
| `packages/email/src/templates/default.ts` | 169 | `<a href="https://classroomio.com/privacy" style="color:#94a3b8;text-decoration:none;">Privacy</a>` | User-visible URL / copy |
| `packages/email/src/utils/constants.ts` | 38 | `const DEFAULT_EMAIL_FROM = '"Best from Integer Training LMS" <notify@mail.classroomio.com>';` | Email address / sender - REPLACE |
| `packages/email/src/utils/constants.ts` | 39 | `const DEFAULT_EMAIL_REPLY_TO = '"Best from Integer Training LMS" <help@classroomio.com>';` | Email address / sender - REPLACE |
| `packages/db/src/auth/email-verification.ts` | 48 | `const orgName = org?.name?.trim() || 'ClassroomIO';` | User-visible URL / copy |
| `packages/db/src/auth/email-verification.ts` | 53 | `from: org?.name ? buildEmailFromName(`${org.name} (via ClassroomIO.com)`) : undefined,` | Email address / sender - REPLACE |
| `packages/db/src/auth.ts` | 109 | `cookiePrefix: 'classroomio',` | INTERNAL identifier (cookie/localStorage key) - do NOT rename casually |
| `packages/db/src/constants.ts` | 12 | `'https://*.classroomio.com',` | Allow-list/code logic (vendor hosts) - leave or prune |
| `packages/db/src/constants.ts` | 13 | `'https://*.myclassroomio.com',` | User-visible URL / copy |
| `packages/db/src/scripts/notify-students-over-limit.ts` | 53 | `const upgradeUrl = `https://app.classroomio.com/org/${org.siteName ?? ''}?upgrade=true`;` | User-visible URL / copy |
| `packages/db/src/utils/custom-domain/trusted-origin.ts` | 26 | `function isClassroomioHost(hostname: string): boolean {` | User-visible URL / copy |
| `packages/db/src/utils/custom-domain/trusted-origin.ts` | 90 | `if (process.env.PUBLIC_IS_SELFHOSTED !== 'true' && isClassroomioHost(hostname)) {` | User-visible URL / copy |
| `packages/db/src/utils/seed/exerciseTemplate.ts` | 5 | `const EXERCISE_TEMPLATES_CDN_URL = 'https://assets.cdn.clsrio.com/exerciseTemplates.json';` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `packages/core/src/services/agent/summarize.ts` | 5 | `const SUMMARIZE_SYSTEM_PROMPT = `You are summarizing a multi-turn ClassroomIO course-creation chat so the assistant can ` | User-visible URL / copy |
| `packages/utils/src/constants/domains.ts` | 6 | `export const TENANT_ROOT_DOMAIN = 'myclassroomio.com';` | User-visible URL / copy |
| `packages/utils/src/constants/domains.ts` | 9 | `export const BRAND_ROOT_DOMAIN = 'classroomio.com';` | User-visible URL / copy |
| `packages/utils/src/constants/embeds.ts` | 1 | `export const EMBED_PUBLIC_HOST = 'embed.classroomio.com';` | User-visible URL / copy |
| `packages/utils/src/openapi/public-api.ts` | 1 | `export const PUBLIC_API_BASE_URL = 'https://api.classroomio.com/public-api/v1';` | User-visible URL / copy |
| `packages/utils/src/openapi/public-api.ts` | 2 | `export const PUBLIC_API_OPENAPI_URL = 'https://api.cdn.clsrio.com/openapi/public-api/openapi-latest.json';` | User-visible URL / copy |
| `packages/utils/src/openapi/public-api.ts` | 7 | `export const PUBLIC_API_OPENAPI_DESCRIPTION = `Use the ClassroomIO public API to manage audience members and courses wit` | User-visible URL / copy |
| `packages/utils/src/openapi/public-api.ts` | 15 | `1. Sign in to [ClassroomIO](https://app.classroomio.com) as an **organization admin**.` | User-visible URL / copy |
| `packages/utils/src/openapi/public-api.ts` | 16 | `2. In the org sidebar, open the **Automation** section, then **API** ([/org/*/api](https://app.classroomio.com/org/*/api` | User-visible URL / copy |
| `packages/utils/src/openapi/public-api.ts` | 36 | `> **Paid Access** — On ClassroomIO Cloud, API key creation is available on **Early Adopter** and **Enterprise** plans.` | User-visible URL / copy |
| `packages/utils/src/openapi/public-api.ts` | 71 | `title: typeof info.title === 'string' ? info.title : 'ClassroomIO Public API',` | User-visible URL / copy |
| `packages/utils/src/plans/data.ts` | 19 | `'ClassroomIO branding'` | User-visible URL / copy |
| `packages/utils/src/validation/README.md` | 3 | `Shared validation schemas for ClassroomIO workspace using Zod with **convention-based translations**.` | User-visible URL / copy |
| `packages/utils/src/validation/widget/build-payload.ts` | 61 | `poweredByLabel = 'Powered by Classroomio'` | User-visible URL / copy |
| `packages/utils/src/validation/widget/widget.ts` | 16 | `export const WIDGET_THEME_PRESET_VALUES = ['classroomio', 'graphite', 'linen', 'spruce'] as const;` | INTERNAL identifier (widget theme preset enum) - leave |
| `packages/utils/src/validation/widget/widget.ts` | 149 | `themePreset: 'classroomio' as const,` | INTERNAL identifier (widget theme preset enum) - leave |
| `packages/utils/src/validation/widget/widget.ts` | 269 | `themePreset: ZWidgetThemePreset.default('classroomio'),` | INTERNAL identifier (widget theme preset enum) - leave |
| `packages/utils/src/validation/widget/widget.ts` | 554 | `const availableThemes: TWidgetThemePreset[] = isPaidPlan ? [...WIDGET_THEME_PRESET_VALUES] : ['classroomio'];` | INTERNAL identifier (widget theme preset enum) - leave |
| `packages/utils/src/validation/widget/widget.ts` | 555 | `const themeCandidate = selectedTheme ?? 'classroomio';` | INTERNAL identifier (widget theme preset enum) - leave |
| `packages/utils/src/validation/widget/widget.ts` | 556 | `const selectedResolvedTheme = availableThemes.includes(themeCandidate) ? themeCandidate : 'classroomio';` | INTERNAL identifier (widget theme preset enum) - leave |
| `packages/ui/src/custom/course-card/constants.ts` | 1 | `export const DEFAULT_COURSE_BANNER_IMAGE = '/images/classroomio-course-img-template.jpg';` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `packages/ui/src/custom/live-session-card/live-session-card.svelte` | 126 | `'PRODID:-//ClassroomIO//Live Session//EN',` | User-visible URL / copy |
| `packages/ui/src/custom/live-session-card/live-session-card.svelte` | 128 | ``UID:session-${startMs}@classroomio`,` | User-visible URL / copy |
| `packages/ui/src/custom/media-player/players/muse-player.svelte` | 13 | `? `https://muse.ai/embed/${svid}?logo=https://app.classroomio.com/logo-512.png&subtitles=auto&cover_play_position=center` | Asset/CDN URL (third-party hosted; self-host or replace) |
| `packages/ui/src/custom/org-landing-page/fixtures.ts` | 104 | `'See how teams use ClassroomIO to assign programs, track progress, and generate certificates — automatically.',` | User-visible URL / copy |
| `packages/ui/src/custom/public-course/mobile-sheet.svelte` | 34 | `poweredByBrand = 'ClassroomIO'` | User-visible URL / copy |
| `packages/ui/src/custom/public-course/powered-by.svelte` | 26 | `brand = 'ClassroomIO',` | User-visible URL / copy |
| `packages/ui/src/custom/public-course/powered-by.svelte` | 34 | `const url = new URL('https://classroomio.com');` | User-visible URL / copy |
| `packages/ui/src/custom/public-course/powered-by.svelte` | 68 | `<img src="/logo-192.png" class="ui:size-6" alt="ClassroomIO" />` | User-visible URL / copy |
| `packages/ui/src/custom/public-course/shell.svelte` | 89 | `poweredByBrand = 'ClassroomIO',` | User-visible URL / copy |
| `packages/ui/src/custom/public-course/sidebar.svelte` | 42 | `poweredByBrand = 'ClassroomIO',` | User-visible URL / copy |
| `packages/ui/src/custom/simple-logo-nav/simple-logo-nav.svelte` | 5 | `href="https://classroomio.com"` | User-visible URL / copy |
| `packages/ui/src/custom/simple-logo-nav/simple-logo-nav.svelte` | 10 | `<img src="/logo-512.png" class="ui:w-7 ui:h-7" alt="ClassroomIO Logo" />` | User-visible URL / copy |
| `packages/ui/src/custom/simple-logo-nav/simple-logo-nav.svelte` | 11 | `<span class="ui:text-foreground ui:text-md">ClassroomIO</span>` | User-visible URL / copy |
| `packages/ai-assistant/src/prompt/student.ts` | 142 | `return `You are an AI tutor for ClassroomIO, helping a learner work through course material.` | User-visible URL / copy |
| `packages/ai-assistant/src/prompt/teacher.ts` | 40 | `return `You are an AI assistant for ClassroomIO, helping a teacher create and organize course content.` | User-visible URL / copy |
| `packages/ai-assistant/src/prompt/teacher.ts` | 314 | `- Put only the lesson body in the content. Do NOT include the lesson title — ClassroomIO already renders it separately` | User-visible URL / copy |
| `packages/jobs/src/connection.ts` | 79 | `'REDIS_URL is not set. ClassroomIO requires Redis for the BullMQ job queue. ' +` | User-visible URL / copy |


##### D. Multi-file code changes that the grep tables imply (do these as deliberate edits, not find/replace)

1. **Email layer** (`packages/email`): `templates/default.ts` (line 4 logo constant -> Gecko-hosted PNG; line 37 `href=https://classroomio.com` -> Gecko site; lines 163-169 footer "Integer Training LMS <year>. All rights reserved." + link block), `utils/constants.ts:38-39` fallback From/Reply-To (`notify@mail.classroomio.com`, `help@classroomio.com` - only used when env unset, but fix anyway), `emails/forgot-password.ts:8,16,23`, `emails/on-password-reset.ts:8`, `emails/invite-teacher.ts:10,29,30`, `emails/welcome.ts:8,15,23` ("My name is Best, the founder of Integer Training LMS" - rewrite or remove), `src/ics.ts:62`.
2. **"(via <brand>)" From display names** - 21 call sites in `apps/api/src/services/{course/invite,course/people,course/notify-exercise,course/payment-request,newsfeed/newsfeed,organization/audience,organization/invite,submission/submission}.ts`, `apps/api/src/utils/course-completion.ts:91`, `apps/jobs/src/processors/notifications/{notify-session-update,session-reminder-scan}.ts`, `packages/db/src/auth/email-verification.ts:48,53` (fallback org name `'ClassroomIO'` and suffix `(via ClassroomIO.com)`), plus `noreply@classroomio.com` reply-to in `newsfeed.ts:444,488`. Recommended: introduce one constant `BRAND_NAME` (e.g. in `@cio/utils`) read by all of them so the next rebrand is one line.
3. **Page titles**: 49 `<title>` strings with `- Integer Training LMS` and 13 with `Pearl LMS`; `routes/+page.svelte:23`; `metaTags.server.ts:10-12,107` (DEFAULT_TITLE/DEFAULT_DESCRIPTION: "The Integer Training learning platform - access your courses, workbooks and progress in one place." -> rewrite for Gecko).
4. **Dead vendor links** (decide: remove or repoint): `https://classroomio.com/...` (+error, 404, page-restricted, powered-by, upgrade-modal, settings docs link, api page docs link), `help@classroomio.com` (sidebar menu SUPPORT_EMAIL, verify-email-error mailto, error.html), `app.classroomio.com` (welcome-modal), `t.me/classroomio_bot` (integrations page), `api.classroomio.dev` (token-auth pages, gated off), `pgrest.classroomio.com` quiz artwork (quiz.ts, 14 URLs; quizzes UI is largely hidden), `assets.cdn.clsrio.com` template/thumbnail images (landing page gallery, widget layouts, view-as-student modal image), `twitter handle '@classroomio'` in OG meta of public course pages, `embed.classroomio.com`. Support email for Gecko is an input needed from the owner.
5. **Hidden features**: the ClassroomIO AI/MCP/Zapier/API-key copy (`automation-utils.ts`, `en.json` lines ~4030-4090) is on disabled surfaces (routes 404 in self-hosted) - rebrand only if you un-hide them.
6. **Docs/repo files** to update (not user-visible): `README.md` fork notice, `docs/*` (DEPLOY, RUNBOOK, ENV, FORK, INTEGRATIONS: domain, droplet IP, Supabase ref, repo URL), `.env.deploy.example` (placeholders `Pearl LMS`), `docker-compose.deploy.yaml` (header comment, `container_name: pearl-*`, `PUBLIC_SOURCE_REPO_URL` default), `docker/Caddyfile` (comment), `.github/workflows/*` header comments, `apps/*/.env.example` Pearl placeholders, `apps/api/scripts/e2e-upload-check.ts`, `packages/db/src/scripts/seed-fixtures.ts` (`@pearl.fixture`), `package.json` `name`/`description` of root and `apps/dashboard` ("classroomio") - cosmetic.

---

### 6. AGPL-3.0 compliance checklist (Gecko fork)

Obligations (FORK.md; AGPL section 13 applies because users interact over a network):
1. **Keep `LICENSE` (AGPL-3.0) and all upstream copyright/notice headers intact** in `newlmsgecko`; state changes (README fork notice: "Gecko Programmes is a modified version of ClassroomIO via PearlLMS"). Do not strip ClassroomIO credits from source headers.
2. **Corresponding Source is public and current**: `https://github.com/Integer-Training/newlmsgecko` must be public (or otherwise offered to every user) and contain exactly what runs. Push the **full git history** (do not squash away upstream authorship).
3. **Visible "Source code (AGPL-3.0)" link** in the running app, logged-out and logged-in. Implementation: `apps/dashboard/src/lib/features/ui/source-code-link.svelte` reads `PUBLIC_SOURCE_REPO_URL` (runtime, `$env/dynamic/public`) with hard-coded default `https://github.com/Integer-Training/LMSclassroom` (line 6). Rendered on the auth footer (`auth-ui.svelte`, covers login/signup/forgot/reset) and in the shared sidebar footer (`ui/sidebar/footer/menu.svelte`).
   - Set `PUBLIC_SOURCE_REPO_URL=https://github.com/Integer-Training/newlmsgecko` in the droplet `.env` AND change the compose default (`docker-compose.deploy.yaml`, dashboard `PUBLIC_SOURCE_REPO_URL: ${PUBLIC_SOURCE_REPO_URL:-...}`), `.env.deploy.example`, `apps/dashboard/.env.example`, and the code default on line 6, so a missing env var can never advertise the wrong repo.
4. **Deployed == pushed**: droplet `git rev-parse HEAD` must equal `origin/main`; no deploy-only patches; every change lands on `main` first (`deploy.sh` uses `git pull --ff-only`). Record deployed commit after each deploy.
5. **No secrets in the public repo/history**: `.env` files are gitignored (`apps/*/.env` exist locally and are untracked - confirm with `git ls-files | grep -i '\.env$'` before the first push to the new remote). Pearl history was audited clean (0 secrets in 5,314 commits **[memory]**); if you push the *same* history to a public Gecko repo it inherits that - but run a fresh secret scan (e.g. `gitleaks detect`) once, since the new repo's visibility is a new decision.
6. **Modifications are themselves AGPL-3.0**; third-party deps keep their licences (pnpm lockfile intact).
7. Privacy side-checks from DEPLOY.md: verify zero telemetry egress (`docker compose logs | grep -iE "posthog|umami|classroomio\.dev"`).
8. If Gecko is ever offered with modified source not on GitHub, the offer must still reach every network user - a link to the repo satisfies this only while the repo is public and current.

---

### 7. Appendix - copying course CONTENT (not people) from Pearl Supabase to Gecko Supabase

Reference implementation: `apps/api/src/services/course/clone.ts` (`cloneCourse`) - same-org clone. It is **incomplete** for a faithful copy (it omits `slug`, `sequential_unlock`, `lesson.unit_type/is_optional/completion_policy/video_watch_threshold/links/slug`, `exercise.course_id/section_id/order/pass_threshold/completion_policy/allow_multiple_attempts/is_unlocked/slug`, and does not copy assets), so a cross-database copy should use the column lists below. All IDs are `uuid` except `question.id`, `option.id`, `lesson_language.id` (**bigint identity**) - let Gecko generate those and map old->new; after bulk insert run `setval` on the identity sequences (clone.ts calls `syncOptionIdSequence()` for `option`).

Prerequisites on the target (Gecko) DB:
- Migrations 0000-0026 applied and essential seed done (`role`, `question_type`, `submission status` reference rows): **`question.question_type_id` and `groupmember.role_id` reference these - do NOT copy those tables; verify ids match** (`question_type` ids/labels identical on both).
- Gecko `organization` row exists (created in onboarding) -> `GECKO_ORG_ID`. A Gecko admin `profile` exists -> `GECKO_AUTHOR_ID`.
- Storage objects copied first or in parallel (see 7.4).

#### 7.1 Tables to copy, in FK-safe insert order

| # | table | copy? | key columns / what it holds | remap on insert |
|---|---|---|---|---|
| 0 | `tag_group`, `tag` (org-level taxonomy used by courses) | optional (only if you want the same tags) | `tag_group(organization_id,name,slug,description,order)`, `tag(organization_id,group_id,name,slug,description,color)` | `organization_id` -> `GECKO_ORG_ID`; `tag.group_id` -> new tag_group id; unique (org, slug) |
| 1 | `group` | **yes**, 1 row per course | `name, description` (id is the course's `group_id`) | `organization_id` -> `GECKO_ORG_ID`; new `id` (old->new map `G`) |
| 2 | `course` | **yes** | `title, description, overview, group_id, is_template, logo, slug, metadata(jsonb), cost, currency, banner_image, is_published, sequential_unlock, certificate(jsonb), compliance(jsonb), status, type, callout(jsonb)` | `group_id` -> `G[old]`; `slug` is **globally unique** (`course_slug_key`) - keep if free in Gecko else suffix; set `is_published=false` initially for review; rewrite storage URLs in `logo`, `banner_image`, `metadata.instructor.imgUrl`, `metadata.reviews[].avatar_url`, `metadata.certificate.templateUrl`, `certificate.design.signatories[].signatureUrl`; new `id` (map `C`) |
| 3 | `course_section` ("Phases"/units grouping) | **yes** | `title, order, course_id` | `course_id` -> `C[old]`; new id (map `S`) |
| 4 | `assets` (media manager rows used by lesson videos/docs) | **yes, only rows referenced** by copied lessons/documents (see 7.4) | `organization_id, kind, provider, storage_provider, storage_key, hls_manifest_key, hls_audio_key, source_url, mime_type, byte_size, checksum, title, description, thumbnail_url, thumbnail_candidates, duration_seconds, aspect_ratio, is_external, status, metadata` | `organization_id` -> `GECKO_ORG_ID`; `created_by_profile_id` -> NULL or `GECKO_AUTHOR_ID`; **storage keys/URLs must point at the objects copied into Gecko's buckets**; unique (org, provider, storage_key); new id (map `A`) |
| 5 | `lesson` | **yes** | `title, note, video_url, slide_url, call_url, order, public, lesson_at, is_unlocked, is_complete(=false), completion_policy, video_watch_threshold, videos(jsonb), documents(jsonb), links(jsonb), slug, unit_type, is_optional, course_id, section_id, teacher_id` | `course_id` -> `C`; `section_id` -> `S`; **`teacher_id` -> NULL** (profile FK, Pearl profile does not exist); `is_complete` reset to false; inside `videos[]` and `documents[]` rewrite `assetId` -> `A[old]`, `key`/`link` -> new storage key/URL (documents carry the coursework template metadata: `kind` = resource/workbook/casestudy/assignment, `dueAt`, `allowDrafts`, `downloadable`); new id (map `L`) |
| 6 | `asset_usages` | **yes** (for rows whose `asset_id` was copied) | `asset_id, target_type, target_id, slot_type, slot_key, position` | `organization_id` -> Gecko org; `asset_id` -> `A`; `target_id` (text) -> remapped lesson/course id as appropriate to `target_type`; `created_by_profile_id` -> NULL; unique (asset,target_type,target_id,slot_type,slot_key) |
| 7 | `lesson_language` | **yes** | `lesson_id, locale, content` (the rich-text lesson body) | `lesson_id` -> `L`; `id` bigint -> let identity generate; rewrite any embedded `media`-bucket URLs / presigned `documents` keys inside `content` HTML (`db:rewrite-media-host` script exists for host swaps - `packages/db/src/scripts/rewrite-media-host.ts`, vars `OLD_BUCKET_DOMAIN`/`NEW_BUCKET_DOMAIN`) |
| 8 | `exercise` (quizzes / assessments) | **yes** | `title, description, lesson_id, course_id, section_id, order, is_unlocked, due_by, allow_multiple_attempts, section_display_mode, completion_policy, pass_threshold, slug` | `lesson_id` -> `L`; `course_id` -> `C`; `section_id` -> `S`; `due_by` -> NULL/reset (stale dates); new id (map `E`) |
| 9 | `exercise_section` | **yes** | `exercise_id, title, description, order, color_theme, after_behavior(jsonb)` | `exercise_id` -> `E`; **inside `after_behavior.exerciseSectionId` (action `go_to_section`) remap to the new section id** (clone.ts does this in a second pass); new id (map `ES`) |
| 10 | `question` | **yes** | `exercise_id, exercise_section_id, question_type_id, title, name(uuid), points, settings(jsonb), order` | `exercise_id` -> `E`; `exercise_section_id` -> `ES` (NULL allowed); `question_type_id` unchanged (reference table); bigint id -> map `Q`; check `settings` for embedded media URLs |
| 11 | `option` | **yes** (skip for TEXTAREA/paragraph type questions - clone.ts does) | `question_id, label, is_correct, value(uuid), settings(jsonb)` | `question_id` -> `Q`; bigint id from identity; then `setval` the sequence |
| 12 | `exercise_template` | optional | org-agnostic question bank (`title, description, tag, questionnaire jsonb`) | none (no org/profile FK) |
| 13 | `tag_assignment` | optional | `tag_id, course_id` | `tag_id` -> new tag; `course_id` -> `C` |
| 14 | `widget`/`widget_course` | **no** (org-level embed widgets) | - | - |

Course "landing page": **there is no per-course landing table.** Course public landing content = the `course` row itself (`overview`, `metadata.*`, `callout`, `logo`, `banner_image`) - copied in step 2. The **organization** landing page is `organization.landingpage` (jsonb) / `organization.customization` / `organization.theme` - org-level branding, **do not copy** (Gecko has its own); if reused, its course references must be remapped (see `packages/db/src/scripts/fix-landing-page-courses-links.ts`).

Certificates config: `course.certificate` (jsonb: theme/design/signatories/threshold/requiredExerciseId) copied inside step 2 - **remap `requiredExerciseId` -> `E[old]`** and any signature image URLs. (Certificates UI is disabled in this fork via `CERTIFICATES_ENABLED=false`, but the config is harmless to carry.)

#### 7.2 Columns that must be remapped (summary)

| column | in table(s) | remap rule |
|---|---|---|
| `organization_id` | `group`, `assets`, `asset_usages`, `tag*` | Pearl org `1b6f0545-cb7e-473a-9258-c664fd2ca95b` **[memory]** -> `GECKO_ORG_ID` |
| `group_id` | `course` | -> new `group.id` (map `G`) |
| `course_id` | `course_section`, `lesson`, `exercise`, `tag_assignment`, `lesson.documents[].key` prefix `materials/{courseId}/` | -> `C`; **the key prefix embeds the old courseId** - rename objects to the new courseId when copying so `assertCourseMaterialDownloadAccess` (checks the course's current material keys) accepts them |
| `section_id` | `lesson`, `exercise` | -> `S` |
| `lesson_id` | `lesson_language`, `exercise` | -> `L` |
| `exercise_id`, `exercise_section_id`, `question_id` | `exercise_section`, `question`, `option` | -> `E`, `ES`, `Q` (+ `after_behavior.exerciseSectionId`, `course.certificate.requiredExerciseId`) |
| `teacher_id` | `lesson` | NULL (or a Gecko `profile.id`) |
| `created_by_profile_id` | `assets`, `asset_usages` | NULL or `GECKO_AUTHOR_ID` |
| `assetId` inside jsonb | `lesson.videos[]`, `lesson.documents[]` | -> `A` |
| storage URLs/keys | `course.logo`, `banner_image`, `metadata.*`, `certificate.*`, `lesson.videos[].link/key`, `lesson.documents[].link/key`, `assets.storage_key/hls_*_key/thumbnail_url/source_url`, HTML in `lesson_language.content`, `lesson.note` | host `<pearl-ref>.storage.supabase.co` -> `<gecko-ref>.storage.supabase.co`; keys keep their path unless it embeds an id above |
| `slug` | `course.slug` (global unique), `lesson.slug`, `exercise.slug`, `tag.slug` | keep if free, else suffix |

#### 7.3 Must be EXCLUDED (people, activity, progress)

`groupmember` (students AND tutors - the cloner is added as TUTOR by `cloneCourse`; for Gecko add `GECKO_AUTHOR_ID` as TUTOR of each new group if you want the course to appear in the tutor-side lists; Admin sees all anyway), `course_invite`, `course_invite_audit`, `profile`, `user`, `session`, `account`, `organizationmember`, `organizationmember_email_notifications`, `learner_profile`, `registration`, `id_verification`, `tutor_allocation`, `coursework_submission`, `coursework_result`, `submission`, `submissionstatus`, `question_answer`, `lesson_completion`, `lesson_video_progress`, `unit_time_spent`, `unit_time_monthly`, `course_completion`, `course_completion_record`, `course_completion_notification_event`, `course_certificate_issue`, `lesson_comment`, `lesson_language_history`, `course_newsfeed`, `course_newsfeed_comment`, `community_question/answer`, `group_attendance`, `notification*`, `message*`, `announcement`, `tutor_feedback`, `audit_event`, `system_event_log`, analytics_* tables, `quiz`/`quiz_play` (interactive quizzes, not course content), `cohort*`/`program*` (+ their course links), `widget*`, `ai_*`, `media_job`/`job_step`/`media_transcript`/`video_transcripts` (regenerate; transcript rows keyed to asset ids - copy only if you rely on existing captions), `course_import_draft`, `organization*` (org-level settings, plans, invites, automation keys, SSO/token auth).

#### 7.4 Storage objects to copy alongside

Source bucket -> target bucket (same names). Build the object list from the copied rows, not by listing buckets blindly:
- `documents`: every `lesson.documents[].key` (materials/workbook/case-study/assignment templates, `materials/{courseId}/...`) - **never** `coursework/...` (learner submissions/feedback).
- `videos`: every `assets.storage_key` + `hls_manifest_key` + `hls_audio_key` (and the whole HLS segment prefix next to the manifest) for copied video assets.
- `media` (public): `course.logo`, `course.banner_image`, `assets.thumbnail_url`/`thumbnail_candidates`, images embedded in lesson HTML, instructor images, signature images. **Do not copy** avatars of Pearl users or the Pearl org logo.
- How: `aws s3 cp --endpoint-url https://<ref>.storage.supabase.co/storage/v1/s3` (path-style) between the two projects with each project's S3 keys, or the Supabase Storage API. Then rewrite URLs/keys in DB (7.2). Verify with a private-bucket presigned GET through the Gecko app and a public `media` `<img>`.
- Check `video` assets of `provider != 'upload'` / `is_external=true` (YouTube, Drive, muse.ai): they have no stored object (only `source_url`/`link`) - nothing to copy.

#### 7.5 Suggested method (to be run later, read-only plan now)

1. In Pearl Supabase, `SELECT` the course set (ids) -> export per-table rows restricted by `course_id` chain (reads only).
2. Generate a SQL/JSON bundle with new UUIDs pre-assigned (deterministic mapping tables `G,C,S,L,E,ES,A` in a scratch schema) so remapping jsonb is a single pass; `question`/`option`/`lesson_language` use identity ids.
3. Insert into Gecko in the order of 7.1 inside one transaction per course; `setval` identity sequences; leave `is_published=false`; then copy storage (7.4); then smoke each course (open lesson, download a workbook, play a video, open a quiz).
4. Never run these writes against Pearl; never touch `coursework_*` rows.
