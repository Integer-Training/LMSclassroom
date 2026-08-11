# BASELINE — stock ClassroomIO on Windows (Phase 0, Step 3)

Recorded 2026-08-11 on the `upstream-baseline` fork (`9adc38bd8`), before any
infrastructure changes. Purpose: prove the unmodified codebase runs end-to-end on
its own stock docker dependencies, so post-baseline failures are attributable to
our changes. Host: Windows 11, Node 20.19.3 (nvm), pnpm 10.19.0, Docker Desktop
29.6.2 (WSL2).

## Bring-up commands (all pass)

```bash
# 1. Toolchain
nvm use 20.19.3            # repo pins ^20.19.3 (.nvmrc); pnpm 10.x
pnpm install              # 2,623 packages

# 2. Per-app .env files (see docs/ENV.md); secrets generated with openssl rand -hex 32
#    apps/api/.env, apps/dashboard/.env, apps/jobs/.env, packages/db/.env
#    (also a root .env for docker-compose ${VAR:?} interpolation)

# 3. Stock docker dependencies (+ Mailpit, added this step — see below)
docker compose -f docker-compose.yaml --profile minio up -d \
  postgres redis mailpit minio minio-init

# 4. Build shared packages, then migrate + seed
pnpm build                                   # Turbo, all packages
pnpm --filter @cio/db db:setup               # migrations + essential seed

# 5. Run (two terminals)
pnpm api:dev          # API :3002 + BullMQ workers
pnpm dashboard:dev    # dashboard :5173
```

Container status at baseline: `cio-postgres` (healthy), `cio-redis` (healthy),
`cio-minio` + `cio-minio-init` (buckets videos/documents/media created),
`cio-mailpit` (SMTP :1025, web UI :8025).

## Manual walkthrough — PASS end-to-end on stock infra

| Step | Result | Evidence |
|---|---|---|
| Sign up (`owner@pearl-lms.test`) | ✅ | `POST /api/auth/sign-up/email` 200; first self-hosted signup auto-verifies email (stock behaviour — no verification email sent) |
| Create org "Pearl Test Org" (`pearltest`) | ✅ | `POST /onboarding/create-org` **201** — first org allowed (the one-org 403 only trips on the 2nd org) |
| Onboarding metadata | ✅ | `POST /onboarding/update-metadata` 200 → redirect to `/org/pearltest` |
| Create course "Baseline Test Course" | ✅ | course id `4bc6ee25-…`; visible in course list |
| Create section + lesson | ✅ | "Module 1" → "Lesson 1 - Baseline" |
| Upload file attachment (PDF, Docs tab) | ✅ | `POST /course/presign/document/upload` 200 → browser PUT to MinIO 200; object on disk at `/data/documents/…-baseline-upload-test.pdf` |
| Retrieve the file | ✅ | `POST /course/presign/document/download` 200 → presigned GET from MinIO **200** |
| Auth email flows to Mailpit | ✅ | password-reset email captured in Mailpit ("Password reset notification - ClassroomIO" → owner@pearl-lms.test) after the fixes below |

## Test suite baseline

No CI runs tests; suites are per-package. Results as run on this checkout:

| Package | Runner | Result |
|---|---|---|
| `@cio/api` | vitest | **72 tests pass**; 6 of 11 test *files* fail to load (pre-existing — see F1) |
| `@cio/email` | vitest | **10 pass** / 10 |
| `@cio/question-types` | vitest | **33 pass** / 33 |
| `@cio/course-app` | vitest | **1 pass** / 1 |
| `@cio/dashboard` | jest | **0 run** — config fails to parse (pre-existing — see F2) |
| `courseapp` (template) | vitest | runs in watch mode (no `--run`), does not terminate in CI-style invocation (pre-existing script shape) |

**Total: 116 tests passing**, 0 test *assertions* failing. All non-green results
are pre-existing harness/config issues, not assertion failures — documented below,
not fixed (per Step 3 instruction to record, not fix, pre-existing failures).

### Pre-existing failures (NOT introduced by our changes)

- **F1 — `@cio/api` 6 test files fail to load** with
  `Failed to load url @cio/core/services/… (Does the file exist?)` for subpaths
  like `@cio/core/services/course/go-live-readiness`,
  `@cio/core/services/agent/question-update`, `@cio/db/queries/notifications`.
  The target files **exist** in `dist/` and the full `pnpm build` is green; this
  is a vite/vitest resolver quirk with `@cio/core`'s wildcard subpath exports
  (`"./services/*"`). Independent of our work — our only build-side change (F4)
  made `@cio/core` build at all, which is what lets the other 72 api tests run.
- **F2 — `@cio/dashboard` jest suite cannot start**:
  `jest.config.ts(10,1): TS1295 … verbatimModuleSyntax` — ts-node cannot compile
  the TS jest config under the repo's TS settings. Zero tests execute. Pre-existing
  toolchain mismatch.
- **F3 — the stock `test` script for `@cio/api` is `vitest NODE_ENV=test`**, which
  passes `NODE_ENV=test` to vitest as a positional **filter**, so `pnpm --filter
  @cio/api test` reports "No test files found, exiting with code 1". Running vitest
  with `NODE_ENV` as an actual env var yields the 72-pass result above. Pre-existing
  script defect.

## Windows / local-dev fixes applied this step (minimal, documented)

- **F4 — `packages/core/scripts/restore-bare-specifiers.mjs` (Windows path bug).**
  The script used `new URL('../dist/', import.meta.url).pathname`, which on Windows
  yields `/C:/Users/…` and made `fs` resolve `C:\C:\Users\…` → `@cio/core:build`
  failed, cascading to api/dashboard. **Fix:** use `fileURLToPath(...)` instead of
  `.pathname`. *Impact:* build-only, cross-platform-safe (fileURLToPath is correct
  on POSIX too); unblocks the entire build. This is the single change that makes
  the stock codebase build on Windows.
- **F5 — Mailpit added + stock email path taught to reach an auth-less catcher.**
  Upstream compose ships **no** mail catcher and the nodemailer transport
  (`packages/email/src/utils/services/nodemailer.ts`) hard-requires
  `SMTP_USER`+`SMTP_PASSWORD` and forces `requireTLS` on any non-465 port — so it
  cannot talk to a local Mailpit (no auth, no TLS). Changes:
  - Added a `mailpit` service to `docker-compose.yaml` (SMTP :1025, UI :8025).
  - Added an **opt-in** `SMTP_ALLOW_INSECURE` env flag (`packages/email/src/config/env.ts`).
    When `'true'`: auth creds become optional and `requireTLS` is dropped. **When
    unset (production default) the code path is byte-for-byte unchanged** — no real
    SMTP provider is affected.
  - Set `SMTP_ALLOW_INSECURE=true` in `apps/api/.env` + `apps/jobs/.env` for local dev.
- **F6 — `SMTP_HOST=127.0.0.1`, not `localhost`.** Node 18+ resolves `localhost`
  to IPv6 `::1` first, but Mailpit binds `127.0.0.1:1025` → `ECONNREFUSED ::1:1025`.
  Using the IPv4 literal fixes it. Local-dev env only.
- **F7 — `scripts/format-changed.mjs` pre-commit hook broken on Windows.** It ran
  `spawnSync('prettier', …)` without `shell: true`; Windows can't launch prettier's
  `.CMD` shim that way, so the script silently exited 1 and **every commit failed
  the lefthook pre-commit hook** (lefthook's generic "Prettier formatting check
  failed" text masked the real cause — prettier never actually ran). **Fix:** add
  `shell: true` to that spawn. POSIX behaviour unchanged. This is required to commit
  at all on Windows.

## Notes / known-benign at baseline

- `apps/docs` warns `Unsupported engine: wanted node >=22.12` (repo pins Node 20).
  We don't build/deploy the docs site; harmless.
- Media/thumbnail workers log `ffmpeg-binaries-missing` and the known
  `ffmpegProbeLuma` export bug (DEV_SETUP_NOTES §6). Only the two media workers are
  affected; API/dashboard/emails/maintenance are fine. Not exercised by the walkthrough.
- Redis "Connection timeout (reconnecting)" lines appear once at worker startup then
  settle to "ready" — cosmetic reconnect noise, all workers report ready.
