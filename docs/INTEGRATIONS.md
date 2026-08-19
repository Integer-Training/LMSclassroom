# INTEGRATIONS.md — the integrations register (Phase 7 Step 5)

Every integration surface in the fork, with an explicit verdict. The register's test: **does learner-related
data leave our infrastructure, and did the owner explicitly accept it?** Verdicts are **keep** / **disable** /
**defer**. Current state reflects the Phase-0 privacy patches + the Phase-7 signup closure already applied.

Sign-off column: ✅ = owner-signed. **The owner signed off the entire register as drafted on 2026-08-19**
("sign off all as drafted") — every **keep** that sends learner-related data (Supabase, SMTP, external media
embeds) and every **disable** action below. The egress re-audit (§ Egress) proves the live set matches the keeps.

---

## 1. Infrastructure (keep — this is our own infra)

| # | Integration | Data flow (what / where / when) | Verdict | Disablement / notes | Sign-off |
|---|---|---|---|---|---|
| I1 | **Supabase Postgres** (`cvtmymxxjgjshrzsjxnj`) | ALL app data — learner accounts, coursework metadata, results, messages, registrations, ID checks. Our owned Supabase project (EU-west-1). | **keep** | It IS our database. Pooled runtime + session-pooler migrations, SSL. | ✅ |
| I2 | **Supabase Storage** (S3) | Coursework `.docx` + lesson materials (private buckets, presigned URLs); avatars/thumbnails (public `media`). Our owned project. | **keep** | Our object storage. Learner uploads never leave our infra. | ✅ |
| I3 | **SMTP mailer** (local Mailpit; prod = AWS SES via the Pearl Email Engine, TBD) | Transactional email → the mail provider sees the **recipient email address** + subject + a content-light body (verify / reset / set-password invite / Phase-6 notifications — announce + link, no bodies/feedback/results). | **keep** | Inherent to email. Env-driven sender identity. **Sends a learner's email address to the mail provider** — needs explicit sign-off. | ✅ |
| I4 | **Redis** (BullMQ + caches) | Internal only — job queue + rate-limit/session caches. No internet egress. | **keep** | Runs on our host; not an external surface. | ✅ (internal) |

## 2. Media embeds in materials (keep the capability — learner browsers fetch)

| # | Integration | Data flow | Verdict | Notes | Sign-off |
|---|---|---|---|---|---|
| M1 | **External video embeds** — YouTube, Google Drive, muse.ai, generic iframes (`embed-link.svelte`, `youtube-video.svelte`, …) | Staff MAY paste an external video URL into a lesson; when a learner views it, **the learner's browser fetches directly from the provider** (revealing the learner's IP + which video to that host). **No server-side egress.** | **keep** | Passive client embeds — how embeds work. Uploaded videos instead go to **our** Supabase HLS (no third party). **A learner's browser contacting an embed host is learner-related** — needs sign-off (or a policy to use uploads only). | ✅ |

## 3. Auth / OAuth providers (disable — already closed)

| # | Integration | Data flow | Verdict | Disablement | Sign-off |
|---|---|---|---|---|---|
| A1 | **Google social login** | Would OAuth to accounts.google.com + auto-create accounts. | **disable** | **Already removed** (Phase 0/1) — `socialProviders` deleted from `auth.ts`. | ✅ (done) |
| A2 | **SSO (OIDC JIT)** `sso()` | A real IdP login for a domain matching an active `organization_sso_config` would JIT-create a user. Tables empty. | **disable** | **Already gated self-hosted-off** (Phase 7 Step 2, `buildStrangerAccountPlugins`). | ✅ (done) |
| A3 | **Token exchange** `tokenExchange()` | Would `signUpEmail` for an unknown email given an active `organization_token_auth` row + signed JWT. | **disable** | **Already gated self-hosted-off** (Phase 7 Step 2). | ✅ (done) |
| A4 | **OAuth proxy** `oAuthProxy()` | Cloud tenant/BYOD OAuth callback routing. | **disable** | **Already self-hosted-off** (stock `buildOAuthProxyPlugin`). | ✅ (done) |

## 4. Automation / webhooks (disable — not owned)

| # | Integration | Data flow | Verdict | Proposed disablement | Sign-off |
|---|---|---|---|---|---|
| W1 | **Public API v1** (`/public-api/v1` — Zapier target: courses + **audience/learner** CRUD via automation keys) | Inbound: an external system holding an org automation key can read/write courses AND audience members (**learner records**). | **disable** | Owner does not use Zapier/MCP. **Don't mount `/public-api/v1` when `PUBLIC_IS_SELFHOSTED`** (config-off, clean). | ✅ |
| W2 | **Automation-key management** (`/organization/automation` — create/rotate/revoke mcp/api/zapier keys) | Admin creates sha256-hashed keys that feed W1 + MCP. | **disable** | Feeds a disabled surface. **Don't mount `/organization/automation` self-hosted-off.** | ✅ |
| W3 | **Polar webhook (inbound)** (`/api/polar/webhook`) | Inbound order/subscription events → credit purchase / plan change. Dead without `POLAR_*`. | **disable** | Commerce — see C1. Removed with the Polar routes. | ✅ |
| W4 | Outbound webhooks | None wired (the `webhooks` BullMQ queue is declared-but-dead — no worker/producer). | **keep** (inert) | Nothing to disable. | ✅ (none) |

## 5. Commerce (disable/remove — closed non-commercial LMS)

| # | Integration | Data flow | Verdict | Proposed disablement | Sign-off |
|---|---|---|---|---|---|
| C1 | **Polar billing** (`/api/polar/{buy-tokens,portal,subscribe,webhook}` + `api.polar.sh`) | Token-pack / subscription checkout + webhook. Dead without `POLAR_*`; self-hosted auto-provisions ENTERPRISE so billing is bypassed. | **disable/remove** | **Remove the 4 `/api/polar/*` dashboard routes** — a commerce fiction on a closed provisioned LMS (removal is the honest means; config-dead would leave a latent surface). | ✅ |
| C2 | **Manual payment-request** (`payment-request.ts` — `teacherStudentBuyRequest` / `studentProvePayment` emails) | Internal only — two emails, NO payment provider, no charge. Unused in the closed staff-provision model. | **keep** (inert) | No external egress (internal emails). Leave as-is; unreachable in the closed flow. | ✅ (inert) |
| C3 | **Stripe** dependency | `stripe@^14` declared in `apps/dashboard/package.json` but **no runtime import** anywhere. | **defer** | Dormant dep, not wired. Removing the package is cosmetic; defer to a dependency-cleanup pass. | ✅ (dormant) |

## 6. AI providers (keep the capability, OFF by default — inert without a key)

| # | Integration | Data flow | Verdict | Notes | Sign-off |
|---|---|---|---|---|---|
| AI1 | **AI assistant** — OpenAI / Anthropic / Google / Moonshot (ai-tutor, question-gen, course-gen) | Would send prompt content to the provider. **No key configured → no call** (caller 503s). | **keep** (inert) | Owner may enable an AI tutor later. Off until a key is set — that would be its own decision (learner content → AI provider). | ✅ |
| AI2 | **OpenAI Whisper** (video transcription) | Would send uploaded audio to `api.openai.com`. `OPENAI_API_KEY` unset → off. | **keep** (inert) | Off by default. | ✅ (inert) |
| AI3 | **r.jina.ai** (agent doc-fetch) | Agent tool URL→markdown; SSRF-guarded, paid-plan-gated + optional key. | **keep** (inert) | Off (self-hosted = ENTERPRISE but no agent keys). | ✅ (inert) |
| AI4 | **Unsplash** (cover-image search) | `api.unsplash.com`; `UNSPLASH_API_KEY` unset → off. | **keep** (inert) | Off by default; no learner data. | ✅ (inert) |
| AI5 | **Cloudflare browser-rendering** (certificate PDF/PNG) | Cert render; CF key unset → off; certs out of scope. | **keep** (inert) | Off by default. | ✅ (inert) |

## 7. Telemetry / feedback widgets (disable — mostly already off)

| # | Integration | Data flow | Verdict | Disablement | Sign-off |
|---|---|---|---|---|---|
| T1 | **PostHog** | Product analytics (learner id/email/name historically). | **disable** | **Already removed** (Phase 0 — inert no-op, dep removed). | ✅ (done) |
| T2 | **Umami** | Page analytics. | **disable** | **Already removed** (Phase 0 — inert no-op). | ✅ (done) |
| T3 | **License phone-home** (`enterprise-api.classroomio.dev`) | Hourly-ish license check. | **disable** | **Already removed** (Phase 0 — `fetchLicenseFromApi` deleted; locked by `no-phone-home.test.ts`). | ✅ (done) |
| T4 | **UserJot** (feedback widget) | Transmits **id / email / name / avatar** to `cdn.userjot.com`. Currently `isWidgetAllowed()` returns false when self-hosted, but the init call still ships. | **disable** | **Propose hard-remove the init call** (BASELINE-recommended): it is PII-capable and only flag-gated — removal eliminates the latent surface honestly. | ✅ |
| T5 | **Senja** (testimonials) | Widget; gated on the paid `no-tracking` feature → off. | **keep** (inert) | Off; no learner data on our surfaces. | ✅ (inert) |
| T6 | **Tinybird** (AI observability) | Fire-and-forget agent events; `TINYBIRD_TOKEN` unset → off. | **keep** (inert) | Off by default. | ✅ (inert) |
| T7 | **Sentry** (errors + replay) | DSN-gated AND not-self-hosted-gated → off. | **keep** (inert) | Off by default self-hosted. | ✅ (inert) |

---

## 8. Future integrations — recorded decisions (NOT built)

The owner has mentioned or may want these. Each is a **separate future decision**, scoped in one line; **none
is built in this phase**. (Owner wording to be captured on sign-off.)

| Integration | One-line scope | Status |
|---|---|---|
| **e-Portfolio export** | Export a learner's coursework + results to an external e-portfolio/awarding system. | **not built — separate decision** |
| **Funding-body / ILR exports** | Generate ESFA/ILR-style funding returns from enrolment + progress. | **not built — separate decision** |
| **HR / finance sync** | Push learner/enrolment data to an HR or finance system. | **not built — separate decision** |
| **ID-document storage** | Store the actual identity document (Phase-7 D2 opt-in) with retention + access rules. | **not built — separate decision** |
| **Bulk CSV import** | Bulk-create pending registrations / learners from a CSV. | **not built — separate decision** |
| **Real payment/commerce** | Learner self-purchase via a payment provider. | **not built — separate decision** |
| **External CAPTCHA** | Third-party CAPTCHA on the registration form (Phase 10 hardening candidate). | **not built — separate decision** |

---

## Egress audit (re-run) — to be appended to docs/BASELINE.md after the disablements

Method (per BASELINE.md's Phase-0 audit, same rigour): (1) server-side undici `request:create` diagnostics
probe across api + jobs while exercising the app; (2) built client-bundle grep of the dashboard; (3) the
`no-phone-home` unit test; (4) repo-wide source grep. Swept set = the Phase-0 domains **extended** with the
key-gated hosts (`api.tinybird.co`, `cdn.userjot.com`, `widget.senja.io`, `*.sentry.io`, `r.jina.ai`,
`api.polar.sh`, `api.openai.com`, `api.unsplash.com`, `api.cloudflare.com`, AI-provider hosts). **Expected live
egress = the keeps only:** Supabase Postgres + Storage, the SMTP host, and (learner-browser-side) any external
media embed a staff member actually used. Results appended below on completion.

**Re-audit run 2026-08-19 (after the disablements) — PASS. The live egress set matches the register's keeps.**

- **Method 1 — runtime undici probe (API + jobs).** Attached an undici `request:create` diagnostics subscriber
  + a global `fetch` wrapper via `NODE_OPTIONS --import`, then exercised the server paths (public registration →
  DB write + Manager/Admin notification enqueue; approval-queue read; course picker; learner ID-verification
  read). **Result: ZERO outbound HTTP origins** — no telemetry/AI/third-party call fired. (Postgres + Redis +
  SMTP are raw TCP to our own infra, not undici HTTP; the probe catches exactly the HTTP egress that telemetry/AI
  would use.)
- **Method 2 — built client-bundle grep** (`.svelte-kit/output/client`, executable `.js`, `.map` excluded).
  The ONLY swept-host string present is **`widget.senja.io`** (Senja — a **kept, gated-off** marketing widget,
  T5). **`cdn.userjot.com` is gone** (UserJot neutering confirmed); **no** posthog / umami / tinybird / sentry /
  polar / phone-home strings remain.
- **Method 3 — `no-phone-home` unit test** (`apps/api/src/__tests__/no-phone-home.test.ts`) — PASS (license
  check never calls `fetch`; all features licensed locally).
- **Method 4 — repo-wide source grep** (apps + packages, excl. node_modules/dist/build/.svelte-kit). Every hit in
  the **deployed** apps (dashboard/api/jobs) is inert: a comment, a neutered no-op (`services/{posthog,umami,
  userjot}`), a gated-off constant (`tinybird`, `r.jina.ai` — no key), a gated widget (`senja`), or a
  plan-gated dead UI string pointing at the now-**removed** `/api/polar/*` local routes. Live external-host
  strings remain only in **non-deployed** apps (`apps/website`, `apps/tenant-router`) and a dormant `@cio/db`
  Polar-subscription maintenance script — none is served by our deployment.

**Reconciliation — observed egress == register keeps, no surprises:** Supabase Postgres + Storage (I1/I2), the
SMTP mailer (I3), and — learner-browser-side only, if a staff member embeds one — an external media host (M1).
Senja (T5) is bundled but gated off (never fires). Everything else is removed (UserJot/PostHog/Umami/phone-home)
or inert-without-a-key (AI/Unsplash/Cloudflare/Tinybird/Sentry), and the Public API / automation / Polar surfaces
are disabled. No endpoint appeared that is not in the register.

**Disabled-surface checks:** `/public-api/v1` + `/organization/automation` → **404** when
`PUBLIC_IS_SELFHOSTED=true` (`blockWhenSelfHosted`, unit-tested); the 4 `/api/polar/*` dashboard routes are
**deleted** (files gone); UserJot exports are **no-op stubs** (no SDK script, no identify). Full results appended
to docs/BASELINE.md.
