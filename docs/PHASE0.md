# PHASE 0 — verification report (go/no-go for Phase 1)

Independent verification that every Phase 0 exit criterion holds. Compiled 2026-08-12
from (a) a read-only reviewer subagent that checked the actual repo + live app, and (b)
a re-run of the local end-to-end walkthrough and the full test suite. Each criterion has
a verdict + concrete evidence. Accepted debts and the one owner-deferred item are listed
explicitly — nothing is signed off silently.

**Verdict: GO.** 6 of 7 criteria PASS; criterion 6 is PARTIAL by the owner's explicit
choice (real-SMTP email smoke deferred — SMTP is being set up last). No blocker.

Repo `origin/main` HEAD at report time: verify with `git rev-parse origin/main`. Live app:
https://learn.epearlacademy.com.

---

## 1. Full fork + upstream history + provenance; all committed & pushed — ✅ PASS

- `git log` shows continuous upstream history below the fork commit `9adc38bd8`; `git remote -v`
  has origin=Integer-Training/LMSclassroom, upstream=classroomio/classroomio.
- Tag `upstream-baseline` → `9adc38bd8…`, pushed (`git ls-remote --tags origin`), and
  `git branch -r --contains upstream-baseline` includes `upstream/main` (real upstream commit).
- `git status --porcelain` empty; local HEAD == `origin/main`; 0 unpushed.
- `git diff upstream-baseline HEAD -- LICENSE` empty — AGPL-3.0 LICENSE byte-identical to upstream.
- `docs/FORK.md` records forked-from commit, date, hard-fork policy, AGPL §13 posture.
- Repo is **public** (`api.github.com/repos/Integer-Training/LMSclassroom` → `"visibility":"public"`).

## 2. docs/CODEMAP.md + docs/ENV.md exist & accurate; one-org 403 noted, not patched — ✅ PASS

- Both docs exist. Reviewer opened 7 CODEMAP file:line references — all still correct
  (API port `constants/index.ts:5`, `getRequestBaseUrl` `services/api/index.ts:14`, proxy
  `proxy-api-request.ts:16`, `schema.ts:111` session, queues `names.ts:5-15`,
  `getOrganizationCount` `organization.ts:1000`, `app.ts:169` auth handler).
- **One-org 403 present and unpatched:** `apps/api/src/services/onboarding.ts:27-32` still
  throws the 403 when `PUBLIC_IS_SELFHOSTED==='true'` and org count > 0. CODEMAP §11.1
  documents it (cited as `:28-33`, now `:27-32` after intervening commits — right block).

## 3. No telemetry / phone-home egress from any service — ✅ PASS

- `git grep -niE "posthog|umami|enterprise-api\.classroomio\.dev|hz\.oncws\.com"` → every hit is
  an inert no-op stub, a removal comment, or a benign false-positive (a course-app template
  literally named "posthog"; base64 SVG blobs; docs prose).
- Dashboard `posthog`/`umami` service modules are no-op (no `posthog-js` import); `appSetup.ts`
  makes no init calls; all 8 posthog call-sites resolve to the stub; `license.ts` has **zero
  fetch** (`getLicenseStatus` returns all features, guarded by
  `apps/api/src/__tests__/no-phone-home.test.ts`). No `posthog-js`/`posthog-node` in any package.json.
- **Local egress audit (Step 4):** undici probe over API+jobs during exercise → 0 outbound to
  swept hosts. **Prod (live):** `curl https://learn.epearlacademy.com/login` → 0 hits for
  posthog/umami/oncws; only external hosts are the GitHub source link + w3.org SVG ns; prod CSP
  `connect-src` would block a beacon anyway. Container-log audit on the droplet: 0 hits.

## 4. Local end-to-end on Windows (Supabase PG + Storage, local Redis + Mailpit) — ✅ PASS

Re-run 2026-08-12 against Supabase `cvtmymxxjgjshrzsjxnj` with local Redis + Mailpit:
- signup (`phase0check@…`, org context) → 200; verification email captured in **Mailpit**
  ("Confirm your email for LMSClassroom Test Org") → clicked verify link → HTTP 200 →
  Supabase `user.email_verified = true` (confirmed via SQL) → login 200.
- As admin: course + section + lesson created (201); document upload → Supabase presigned PUT
  200 → presigned download served back 200. All steps green.

## 5. "Source code" link visible (logged-in + logged-out), URL from config — ✅ PASS

- `apps/dashboard/src/lib/features/ui/source-code-link.svelte` reads `PUBLIC_SOURCE_REPO_URL`
  from `$env/dynamic/public` (runtime), default the fork repo. Referenced by `auth-ui.svelte`
  (logged-out) and `sidebar/footer/menu.svelte` (logged-in).
- Live proof: prod `/login` HTML contains `Source code (AGPL-3.0)` ×1 and the repo URL ×2.
  Documented in `docs/ENV.md`; present in `apps/dashboard/.env.example`.

## 6. Deployed on DigitalOcean (owner-approved); smoke-tested; deployed == pushed — ⚠️ PARTIAL (owner-deferred)

- **Live over HTTPS:** `curl -o /dev/null -w '%{http_code} tls=%{ssl_verify_result}'` →
  `200 tls=0` (valid Let's Encrypt cert); HTTP→HTTPS 308. Shape A (droplet + compose + Caddy),
  owner-approved before any resource was created. `docs/DEPLOY.md` has the full record.
- **Deployed == pushed:** the droplet's `git rev-parse HEAD` **equals** `origin/main`
  (verified live on the droplet), and the app is built from source there.
- **Smoke test on prod:** login + authed API via `/proxy`, course/section/lesson, document
  upload → Supabase → presigned download, unauthenticated object URL denied (400, private
  bucket), container-log telemetry audit = 0 hits — all pass.
- **Deferred by owner:** the **real-SMTP email flows** (fresh signup verification, password
  reset, invite). SMTP is intentionally being configured last. Recorded in `docs/DEPLOY.md`
  §"Deferred". To close: set SMTP on the droplet `.env`, `up -d`, re-run the three email flows.

## 7. Test suite green or pre-existing failures recorded; no new regressions — ✅ PASS

Re-run 2026-08-12, matches `docs/BASELINE.md`:
- `@cio/api` 74 tests pass; **6 of 12 files fail to load** — pre-existing vite wildcard-export
  resolver quirk (BASELINE F1), not assertion failures.
- `@cio/email` 12 pass, `@cio/question-types` 33 pass, `@cio/course-app` 1 pass.
- `@cio/dashboard` jest: 0 run — pre-existing `TS1295` config break (BASELINE F2).
- **No new regressions.** Every non-green result is documented in BASELINE.md.

---

## Deviations fixed during this review (in Phase 0 scope)

- `apps/api/.env.example` now sets `PUBLIC_IS_SELFHOSTED="true"` with a "must match dashboard"
  warning — it previously never assigned the var despite two docs flagging the mismatch footgun.
- `docs/DEPLOY.md` deployed-commit line reworded: states the "droplet HEAD == origin/main"
  invariant + a live verify command instead of a frozen hash that inherently trails by one.
- `docs/ENV.md` §10 added for the deploy-only vars `APP_DOMAIN` / `PUBLIC_APP_URL`.

## Accepted debts / deferrals (not blockers)

- **Prod real-SMTP email smoke — DEFERRED by owner** (criterion 6). The only outstanding
  functional item; closes in ~5 min once SMTP is set up.
- **Prod CSP carries dev leftovers** (`http://localhost:3002`, `http://localhost:9000`) in
  connect/img/media-src, hardcoded in stock `apps/dashboard/svelte.config.js` and baked at build
  time. Cosmetic, not exploitable (browsers won't reach localhost from a prod page). Fix = edit
  the stock CSP config + rebuild/redeploy the dashboard; deferred to a hardening/branding pass.
- **`docs/TODO-BRANDING.md`** — ~14 hardcoded "ClassroomIO" strings in the email layer
  (masthead logo/footer/subjects, `(via ClassroomIO.com)` sender names). Cosmetic; links already
  resolve via `DASHBOARD_ORIGIN`. Deferred to a dedicated rebrand.
- **One-org 403** (`onboarding.ts:27-32`) — recorded, deliberately unpatched in Phase 0.
- **Pre-existing test-harness failures** — api F1 (vite subpath resolver) + dashboard jest F2
  (TS1295); documented in BASELINE.md, not fixed this phase.
- **Carried-forward upstream bugs** (per CODEMAP): `ffmpegProbeLuma` missing export crashes the
  two media workers; three dead queues (`webhooks`, `course-imports`, `onboarding-bootstrap`);
  `apps/docs` needs Node ≥22.12; no CI workflow runs tests.
- **`apps/website` feature flags** (`PUBLIC_ENABLE_FAQ/STATS/USERS_COMPANIES`) undocumented in
  ENV.md — the marketing site is not deployed by us (CODEMAP §1); intentionally out of scope.
