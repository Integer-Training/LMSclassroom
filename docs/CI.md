# CI.md — GitHub Actions on the PearlLMS fork

This is a **hard-fork of ClassroomIO**. The upstream repo ships CI workflows wired to
**ClassroomIO's own infrastructure** (their Cloudflare R2 buckets, docs site, and container
registry). On the `Integer-Training/LMSclassroom` fork those secrets don't exist, so those
publish/deploy workflows **failed on every push and emailed the failure** — the noise this
document explains and fixes.

We push **directly to `main`** (no PR flow yet) and deploy to **DigitalOcean**, not to
ClassroomIO's registry/R2/docs. So the fix is: keep the workflows that give real signal
(build checks), and switch the upstream publish/deploy pipelines to **manual-dispatch only**
(`workflow_dispatch:`) so they never auto-run — the files are kept, not deleted, so they can
be re-pointed at *our* infra later.

## What runs on a push to `main` now

| Workflow | Trigger now | Why |
|---|---|---|
| Package build check | push `main` + PR | ✅ real CI — keep. Fails only on a genuine build break |
| MCP package build check | push `main` + PR | ✅ real CI — keep |
| UI Tailwind prefix check | push `main` (ui paths) + PR | ✅ real CI — keep |
| **Upload OpenAPI Spec to R2** | **manual only** (was: push) | Publishes spec to ClassroomIO R2 + their docs hook — secrets absent → always failed |
| **Publish Docker Images** | **manual only** (was: push) | Publishes to their registry + boot smoke test needs `DATABASE_URL` — always failed |
| **Deploy embeds to R2** | **manual only** (was: push) | Deploys embeds to ClassroomIO R2 — secrets absent → would fail on ui/embeds changes |

## Not touched (don't fire on our pushes)

- **deploy-storybook** (`storybook-deploy` branch only), **cypress** (`cypress` branch only) — never
  triggered by our `main` pushes.
- **publish-mcp**, **publish-course-app**, **railway-preview** — already `workflow_dispatch` only.
- **assign-issues**, **auto-comment-issues**, **apply-issue-labels-to-pr**, **auto-comment-issues**,
  **semantic-pull-requests**, **railway-preview-teardown** — fire on issue/PR events only. We push
  direct to `main`, so they don't run. They're upstream community automation; harmless, left as-is.

## Re-enabling a publish pipeline later

To wire one of the disabled workflows to *our* infrastructure:

1. Add the required secrets under **Settings → Secrets and variables → Actions** (and, for the
   OpenAPI/embeds ones, the `production` environment they reference):
   - OpenAPI/embeds: `CLOUDFLARE_ACCESS_KEY`, `CLOUDFLARE_SECRET_ACCESS_KEY`, `CLOUDFLARE_ACCOUNT_ID`,
     `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_DOCS_DEPLOY_HOOK`, `PUBLIC_SUPABASE_URL`,
     `PUBLIC_SUPABASE_ANON_KEY` — pointing at **our** R2/account.
   - Docker: registry creds + a reachable `DATABASE_URL` for the smoke test.
2. Restore the `push:` block in that workflow's `on:` (see the comment at the top of each file for the
   exact original trigger).

Until then: run any of them on demand from the **Actions** tab → the workflow → **Run workflow**.

_Last updated 2026-08-17 — disabled auto-run on Upload OpenAPI Spec to R2, Publish Docker Images,
Deploy embeds to R2 to stop failure-notification emails._
