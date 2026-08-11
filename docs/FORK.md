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
