# Phase 10 — Security Hardening: closing report

Phase 10 is the last committed phase of the PearlLMS roadmap: a whole-codebase security sweep, a web/auth
hardening baseline, dependency + upstream cleanup, operational resilience, and the closing seals. This report is
the roadmap's **closing document** — and the **maintenance cadence below (§4) is what you run the service from**.

**Verdict: GO — hardening complete.** Every register row is dispositioned (fixed-with-commit or
accepted-with-rationale); all seals verified except one owner-gated item (deploy is held at Phase-0 pending AWS
SES — decision D32). Full suite green: **523 tests pass, 0 failures** (api); email 19; question-types 33; the
BASELINE known-failures list is now retired.

**Independent closing review: GO-WITH-NOTES.** A separate reviewer verified every criterion against the actual
code (not just the register): all three spot-checked fixes CONFIRMED in code (SW-7 `ownership.ts`, SW-4
`login-link.ts`, SA-5 `correlation-id.ts`/`errors.ts`/`app.ts`); all hardening controls present; no
claimed-but-missing controls and no silent partial passes. The notes are the honestly-documented residuals below
(SW-5 partial, two fixes without automated tests due to harness limits, CSP `unsafe-eval` pending the click-through
canary) and the owner-gated D32 deploy — all recorded, none blocking.

---

## 1. What was done (Steps 1–7)

| Step | Outcome | Commits |
|---|---|---|
| 1 — Register | `docs/HARDENING-PLAN.md` + owner-confirmed values O1–O6 | seed |
| 2 — Sweep | Whole-codebase find-don't-fix; 57 findings (SW-*/SA-*) | seed |
| 3 — Fix wave | All blockers/majors fixed + tested; minors fixed/accepted/deferred | `9087c1666`..`f991b972d` |
| 4 — Web/auth baseline | CSP (honest + canary), headers, cookies, CSRF verified, rate limits, session/token, **error hygiene + correlation ids** | `fdbf6daf0` |
| 5 — Deps & upstream | Criticals fixed (better-auth, jspdf, drizzle SQLi, adapter-vercel/tar…); accepted exceptions in FORK.md; **zero eligible upstream cherry-picks** | `64683c4fc` |
| 6 — Ops resilience | RUNBOOK.md, log hygiene (secret+PII), `/health`, volume seed; restore-drill procedure (owner-gated exec) | `ae28c8b58` |
| 7 — Seals & close | Baseline debt retired (D1/D3 fixed, D2 accepted), egress re-audit, FORK.md summary, this report | this commit |

## 2. Register — final state

The authoritative register is **`docs/HARDENING-PLAN.md`** (§5d fix log, §5e Step-4, owner-decisions block). Summary:

- **Access IDORs** — SW-1 progress, SW-7 coursework-download, SW-2 clone, SW-3 tutor-PII, SW-10 exercise,
  SW-21 media/HLS: **fixed** with regression tests (self-or-staff / default-deny / staff-only guards).
- **Auth/session** — SW-4 login-link deactivation bypass, O1 7d session, O2 token expiries, SW-13 password policy,
  D29 split-env assertion, D6 link-invite 90d: **fixed**.
- **Injection/encoding** — SW-8 email XSS, SW-17 themeColor CSS-injection, SW-9 raw-SQL params: **fixed**;
  SW-15/16 dashboard `{@html}` accepted (folded into the CSP tightening follow-up).
- **Web baseline** — SA-1 headers, SA-1b honest CSP + canary, SA-2 cookies, SA-3 CSRF-origin leak, SA-4 rate
  limits, SA-5 error hygiene: **fixed/verified**.
- **Deps** — 17→5 criticals (5 = accepted dev-only vitest), 183→76 highs (runtime highs fixed; rest
  documented-accepted). See FORK.md.
- **Accepted-with-rationale / deferred** (all recorded, none silent): vitest/nodemailer/js-yaml/lodash + dev
  tooling deps; SW-18 MIME-sniff; SW-20 presign cache; SW-22 orphaned queues; SW-23 email sender (→ D35/SES);
  CSP `unsafe-eval` (canary evidence pending owner click-through).

## 3. Seals — evidence

| Seal | Status | Evidence |
|---|---|---|
| Register 100% dispositioned | ✅ | HARDENING-PLAN.md §5d/§5e — every row fixed or accepted |
| Egress == INTEGRATIONS.md | ✅ | analytics deps (posthog/userjot) uninstalled; phone-home deleted + `no-phone-home.test.ts` green; Step-5 added no integrations. Swept-host strings are comments/sourcemaps/inert-enterprise-UI (token-auth `api.classroomio.dev`, matches D8) — no live egress beyond the keeps (Supabase, SMTP) + gated-off Senja |
| Baseline debt retired | ✅ | BASELINE.md — F1 fixed (vitest alias), F3 fixed (script), F2 accepted (owner-signed) |
| FORK.md current | ✅ | modifications summary (all phases) + dependency table + upstream disposition |
| LICENSE intact | ✅ | `LICENSE` = GNU AFFERO GPL v3 (unchanged) |
| In-app source link | ✅ | `source-code-link.svelte` → `PUBLIC_SOURCE_REPO_URL` \|\| `github.com/Integer-Training/LMSclassroom` (public) |
| Suite green | ✅ | api **523 pass / 0 fail** (all 67 files load post-D1-fix); email 19 |
| **Deployed == pushed** | ⚠️ **owner-gated** | **NOT met by design** — prod is held at the Phase-0 commit pending **AWS SES** (decision **D32**). The Steps 3–7 security fixes go live only at the SES-gated redeploy. This is an owner decision, not a silent gap — see §5 |

## 4. Maintenance cadence — **run the service from here**

Full detail in **`docs/RUNBOOK.md §7`**. In brief:

**Monthly:** `pnpm audit` → triage new critical/high (patch smallest-first, or add a FORK.md exception); refresh
Docker base images; watch upstream ClassroomIO for **security** commits (`git log upstream-baseline..upstream/main`)
→ cherry-pick security-only, record in FORK.md; confirm backups + uptime monitor green; skim logs for stray
PII/secrets.

**Quarterly:** perform the **restore drill** (RUNBOOK §4) and update its record — a backup you haven't restored
is a belief, not a capability; review deferred hardening items (CSP `unsafe-eval` canary evidence, dep majors).

**Every deploy:** confirm droplet `HEAD == origin/main`; run the smoke (login per role, one upload, one marking,
headers in dev tools, source link present).

## 5. Owner-gated items still open (coordinate — not silently passed)

1. **D32 — the closing redeploy.** Prod runs the Phase-0 build; the Phase 1–10 code (closed registration,
   deactivation, hardening, dep fixes) goes live only when the droplet is rebuilt. Owner chose to **hold until AWS
   SES SMTP** is configured (so provisioning emails deliver). **Action:** configure SES on the droplet `.env`
   (`SMTP_*`), then `docker compose -f docker-compose.deploy.yaml up -d --build`, run the 3 email smokes + the
   per-role smoke, and record deployed HEAD == origin/main. Until then public signup remains open on prod
   (harmless — no real self-registration).
2. **Restore drill execution** (RUNBOOK §4) — needs an owner-created scratch Supabase project; run together, time
   it, delete the scratch + confirm.
3. **Monitoring** — DO uptime check + alert to owner email; fire-test once (RUNBOOK §2).
4. **Backups** — confirm Supabase PITR + daily-backup posture (RUNBOOK §3).
5. **SW-23 email sender** — pull the hardcoded reply-to/From to env when SES lands (with D35 rebrand).
6. **CSP `unsafe-eval`** — do the browser console click-through (ENV.md §12) to gather the report-only canary
   evidence, then remove `unsafe-eval` from the enforced `script-src`.

## 6. Future decisions (recommendations — NOT commitments)

Recorded for the owner to weigh later; none are built or scheduled:

- **Third-party penetration test** — an external pentest is the natural next assurance step now the internal
  hardening baseline is in place. Recommended as an optional independent follow-up.
- **Audit-log viewer** — `audit_event` is populated; a read-only admin viewer would make it useful operationally.
- **Subject-access-request (SAR) / data-export tooling** — GDPR data-portability; not built (closed system, low
  volume today).
- **Retention-policy automation** — automated purge of old PII/coursework per a retention policy.
- **Bulk CSV learner import** — a governed bulk-provision path (today provisioning is per-user admin action).
- **Dashboard vitest migration** — migrate the 3 stray dashboard `.test.ts` files off the broken jest config to
  vitest (the runner used everywhere else), giving the dashboard a real unit suite (retires the F2 acceptance).
- **Dep major bumps** — vitest 1→3, nodemailer 6→9, and the dev-tooling highs, when convenient (monthly cadence).
- **Phases 8–9 (migration / cutover)** — parked by the owner ("migration is not a priority"); revisit only if the
  strategy changes. Live Moodle has content (62 SCORM, 202 H5P) PearlLMS has no player for — records-only if ever
  revived.

---

*Phase 10 closes the committed roadmap. The product is security-hardened at the code level; going live with these
fixes is the SES-gated redeploy (D32). From here, the service is operated from the RUNBOOK cadence.*
