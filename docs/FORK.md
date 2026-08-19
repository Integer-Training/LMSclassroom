# Fork Provenance

## Origin

| | |
|---|---|
| **Upstream repository** | https://github.com/classroomio/classroomio |
| **Forked-from commit** | `9adc38bd8ae8de002d2963f0a892edeb5840dc87` |
| **Upstream branch** | `main` |
| **Fork date** | 2026-08-11 |
| **Baseline tag** | `upstream-baseline` (points at the forked-from commit) |
| **This fork** | https://github.com/Integer-Training/LMSclassroom |

## Hard-fork policy

This is a **hard fork**. We do not track upstream continuously:

- **No continuous upstream merges.** Upstream `main` is not merged into this
  repository after the baseline commit above.
- **Security fixes only.** If upstream publishes a security fix that affects
  code we still carry, it is **cherry-picked** individually, reviewed, and
  committed with a reference to the upstream commit hash.
- The `upstream` git remote is kept solely to fetch such fixes; it is never
  pushed to.

## AGPL-3.0 obligations

ClassroomIO is licensed under the GNU Affero General Public License v3.0
(see [LICENSE](../LICENSE), unchanged from upstream). Because we run this
software as a network service, AGPL section 13 applies. Our compliance
posture:

1. **Source stays published.** The complete corresponding source of the
   deployed application lives in this repository
   (https://github.com/Integer-Training/LMSclassroom) and remains available
   to users of the service.
2. **"Source code" link in the app.** The running application carries a
   visible "Source code" link (logged-in and logged-out), pointing at this
   repository, with the URL supplied via configuration.
3. **Deployed code matches pushed code.** What is deployed must be built
   from a commit that is pushed to this repository — no deploy-only patches.
4. **License and notices preserved.** The upstream LICENSE file and copyright
   notices are kept intact; our modifications are themselves AGPL-3.0.

## Upstream security cherry-picks

Per the hard-fork policy, only **security** fixes are cherry-picked, each recorded here (upstream commit → our
commit → what it fixes).

| Date | Upstream commit | Our commit | What it fixes |
|---|---|---|---|
| — | _none eligible_ | — | See disposition below. |

**Review 2026-08-19 (Phase 10 Step 5), `upstream-baseline..upstream/main` = 47 commits:** zero are security fixes.
All are feature / UI / build fixes (mobile sidebar, charts, certificates UI, cohort UI, responsive tweaks, build
repairs). Two were examined closely and found **not applicable / superseded**:
- `fcbf38f6a` *"prevent self-hosted auto-enroll from downgrading admins/tutors to students"* — **N/A**: our
  self-hosted auto-enroll is **closed** (Phase 1 Step 6 — `auto-join.ts` refuses net-new self-service joins), so
  the downgrade path does not exist here.
- `e67c314c4` *"return standard error shape for unhandled public API 500s"* — **superseded**: Phase 10 Step 4
  already returns a sanitised generic 500 shape **with a correlation id** (`middlewares/correlation-id.ts`),
  which is stronger than the upstream change.

## Dependency security updates (Phase 10 Step 5)

Vulnerable dependencies updated smallest-first, suite green after each batch. Direct bumps:

| Package | From → To | Severity fixed |
|---|---|---|
| `better-auth`, `@better-auth/sso` | 1.4.18 → ~1.6.30 (pinned `<1.7`) | **critical** — OAuth refresh-token replay + SSO provider-registration |
| `jspdf` (+ `jspdf-autotable`) | 2.5.1 → 4.2.1 (autotable 3 → 5) | **critical** — path traversal + HTML injection |
| `drizzle-orm` | 0.44.7 → 0.45.2 | **high** — SQL injection via improper escaping |
| `axios` | 1.4 → 1.15.1 | high — proxy bypass (CVE-2025-62718) |
| `hono` | 4.11.3 → 4.11.4 | high — JWT alg confusion (JWK middleware; unused here) |
| `@hono/node-server` | 1.19.7 → 1.19.10 | high — proxy authorization bypass |
| removed `@sveltejs/adapter-vercel` | (unused) | **critical** — eliminated the `tar` DoS path entirely |

Transitive patches forced via scoped `pnpm.overrides` (only rewrite the vulnerable range): `fast-xml-parser`
(≥5.3.5, crit), `handlebars` (≥4.7.9, crit — dev), `shell-quote` (≥1.8.4, crit — dev), `seroval` (≥1.5.3, crit),
`undici` (≥6.24.0), `nanoid` (≥5.1.16), `ws` (≥8.21.0), `form-data` (≥4.0.6), `@sveltejs/kit` (≥2.49.5),
`axios` (≥1.15.1, all transitive), `minimatch` (3.x ≥3.1.3), `brace-expansion` (1.x ≥1.1.12 + 2.x ≥2.1.2).

**Owner-accepted exceptions (documented, deferred to the monthly audit cadence):**
- `vitest` <3.2.6 (5 paths, the remaining criticals) — **dev-only** test runner; the advisory requires the Vitest
  **UI server** (`vitest --ui`) to be listening, which this project never runs (tests run headless via
  `vitest run`), and vitest is not in any deployed artifact. A 1.x→3.x bump is two majors that would destabilise
  the whole test suite mid-hardening — deferred, not blocking.
- `nodemailer` <9.0.1 — the advisory bypasses a *disabled* `raw` message option; we send only structured mail
  (no `raw`), and 6→9 is three majors. Low exploitability here; deferred.
- Dev-/build-tooling highs (`vite`, `rollup`, `storybook`, `wrangler`, `@babel/*`, `postcss`, `preact`,
  `picomatch`, `minimatch`, `sharp` native, etc.) — not in the deployed runtime attack surface; several need risky
  majors. Deferred to the monthly `pnpm audit` cadence (see RUNBOOK).
- `js-yaml` merge-key DoS — the advisory's "patched ≥4.3.0" does not exist on npm (latest 4.x is 4.1.0); forcing
  it resolved to a **5.x major** that broke the Astro docs-site build tooling (`@astrojs/internal-helpers`). It is
  a low-impact transitive DoS in a **build/docs** dependency (not the deployed runtime), so it is accepted rather
  than force-bumped. Deferred to the cadence.
- `lodash` "≥4.18.0" advisory — no such release exists (4.17.21 is the latest 4.x); unfixable without removing
  the transitive dependency. Accepted.

**Toolchain:** Node pinned `20.19.3` across engines + Docker bases (`docker/Dockerfile.{api,dashboard}`);
`Dockerfile.jobs` tracks `node:20-bookworm-slim` (floating 20 → OS/Node patches on rebuild). Base-image refresh +
`pnpm audit` are on the monthly cadence in the RUNBOOK.
