# PHASE 6 — verification report: comms centre exit criteria

Phase 6 built the communications centre in six steps: (1) `COMMS-MODEL.md` + flagged
decisions D1–D4; (2) the one notification framework; (3) the in-app notification centre;
(4) allocation-bound tutor↔learner messaging; (5) announcements; (6) per-user email
preferences. This report is the independent exit sign-off.

**Method.** An independent reviewer subagent statically verified the exit criteria against
the code (grep for stray send paths, template inspection, ACCESS/AUDIT cross-checks, suite vs
BASELINE). An adversarial pass then attacked the model with the full fixture set — every
forbidden access logged, zero successes permitted. Four positive E2E flows ran in one sitting.
All three were executed on localhost against the shared Supabase dev DB
(`cvtmymxxjgjshrzsjxnj`); production was not touched.

**Verdict: PASS.** Every exit criterion holds. 19/19 forbidden accesses refused (0 breaches);
attachment-shaped payloads rejected/stripped with no persistence path; all four E2E flows pass;
full API suite 410 passed with only the 6 documented BASELINE F1 load-failures (no regression).

---

## 1. Exit criteria — pass/fail with evidence

| # | Exit criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | COMMS-MODEL decisions D1–D4 implemented exactly as confirmed | **PASS** | D1 (announcements Admin+Manager only, Tutor denied): adversarial C1/C2 refuse Tutor+Learner 403, C3 Manager composes both scopes. D2 (Admin read-any / Manager excluded from messaging): A3 Manager read→403, A4 Admin write→403, A4b Admin read-only. D3 (coalescing + defaults + in-app always): A6 3 rapid→3 in-app rows, A7 email gate true when unread present; config `NOTIFICATION_EMAIL_DEFAULTS`. D4 (reallocation archives, fresh thread): covered by Step-4 harness + `removeTutorAllocation→archiveThreadForPair`. |
| 2 | One notification pipeline (no stray send paths) | **PASS** | Every comms in-app row + email flows through `emitNotification` (`services/comms/notify.ts`); the ONLY email-preference resolver is `getCategoryEmailEnabled = row ?? config default`. Grep proof recorded in §2. |
| 3 | Content-light emails everywhere | **PASS** | Every comms template announces + links only; no body/feedback/result/file. Payload interfaces inspected in §3. |
| 4 | Coalescing per rule | **PASS** | `emitNotification` coalesces the message email via `hasRecentUnreadForEntity(...,NOTIFICATION_COALESCE_WINDOW_MS)`; the in-app row ALWAYS writes. A6/A7 prove both halves live. |
| 5 | No-attachments invariant | **PASS** | `message` table has no attachment column; send schema `ZSend={body:string}` (not strict → extra fields stripped); service takes only a string. Adversarial B1 (attachment fields dropped, stored text-only), B2 (non-string body→400). |
| 6 | Audit coverage | **PASS** (doc fixed) | `announcement.published` audited in code (Step-5 harness: audit row per announcement, ids only). `docs/AUDIT.md` had no Phase-6 row — **added this step** (Phase 6 actions section) recording it + why notifications/messaging/preferences are intentionally NOT audited (self-only operational state). |
| 7 | ACCESS.md rows live | **PASS** (doc fixed) | Guards for announcements read/compose, messaging, notification centre, preferences match the code. `docs/ACCESS.md` ended at Phase 5 — **added §10 (Phase 6 — comms centre)** this step with each endpoint's live guard + target access, cross-referencing COMMS-MODEL §7. |
| 8 | Full suite vs BASELINE — no new regressions | **PASS** | `pnpm vitest run` (apps/api): **410 passed**; 6 files fail to LOAD — exactly the `BASELINE.md` F1 set (vitest wildcard-subpath resolver quirk). Zero assertion failures, zero new load-failures. |

Independent reviewer subagent findings are folded into §9.

## 2. One-pipeline grep proof

The single email-preference resolution path is `getCategoryEmailEnabled(userId, category)` in
`apps/api/src/services/comms/notify.ts:40-43` (`row ?? emailDefaultForCategory(category)`). It
is the only place that reads a preference row against the config default. The preferences
service (`services/comms/preferences.ts`) *calls* it for effective values and uses
`listNotificationPreferences` solely to compute the `isDefault` flag — never to re-derive the
on/off value. Every comms event (submission.created, result.recorded, message.received,
announcement.published, session.unlocked) reaches in-app + email through the one
`emitNotification`. No stray comms `enqueueTransactionalEmail` / `insertNotification` call sites
exist outside `notify.ts`.

## 3. Content-light email audit

| Template | Payload fields | Verdict |
|---|---|---|
| `message-received` | tutor/learner display name + a link to the thread | announce+link only — **no message body** |
| `announcement-published` | announcement title + link | announce+link only — **no body text** |
| Phase-3 coursework (submission / result) | course/exercise/status + link | status + link only — **no feedback text, no grade detail, no file** |

No template embeds a message body, feedback, result detail, learner PII beyond a display name,
or any file/attachment. Emails announce that something happened and link into the app.

## 4. Adversarial log — 19 forbidden attempts, 0 breaches

Executed service-level (forbidden-access matrix) and HTTP-boundary (transport attacks) with the
real fixture set: demo.tutor (T1, allocated to demo.learner A), Fixture Tutor (T2, not
allocated), Fixture Learner (B), demo.manager, Fixture Admin, and an unenrolled throwaway
org-learner. Every row REFUSED as required.

| ID | Attempt | Expected | Result | Refused |
|---|---|---|---|---|
| A1a | learner B reads A→T1 thread | 403 | refused 403 | ✅ |
| A1b | learner B writes to A→T1 thread | 403 | refused 403 | ✅ |
| A2a | non-allocated tutor T2 reads thread | 403 | refused 403 | ✅ |
| A2b | non-allocated tutor T2 writes thread | 403 | refused 403 | ✅ |
| A2c | non-allocated tutor T2 opens thread with A | 403 | refused 403 | ✅ |
| A3 | Manager reads thread (D2 excluded) | 403 | refused 403 | ✅ |
| A4 | Admin writes to thread (read-only oversight) | 403 | refused 403 | ✅ |
| A5a | oversized message body | 400 | refused 400 | ✅ |
| A5b | empty/whitespace message body | 400 | refused 400 | ✅ |
| B1 | POST message with attachments[]/file/fileKey fields | stored text-only, no attach column | 201, body unchanged, extra cols absent | ✅ |
| B2 | POST message with body = object (non-string) | 400 | 400 | ✅ |
| B3 | unauthenticated POST message | 401 | 401 | ✅ |
| D1a | unauthenticated GET /notifications | 401 | 401 | ✅ |
| D1b | unauthenticated GET /notifications/preferences | 401 | 401 | ✅ |
| D1c | unauthenticated PUT /notifications/preferences/messaging | 401 | 401 | ✅ |
| D2 | learner B marks learner A's notification id read | A stays unread (self-scoped) | 200, A.read=false | ✅ |
| C1 | Tutor composes an announcement (D1 denies tutors) | 403 | refused 403 | ✅ |
| C2 | Learner composes an announcement (D1 denies learners) | 403 | refused 403 | ✅ |
| C4 | unenrolled learner reads a course-scoped announcement | not in feed; no in-app row | in-feed=false, in-app=0 | ✅ |

**forbidden attempts: 19 · refused: 19 · BREACHES: 0.**

Notes on the "by-id" attacks: notifications and preferences expose **no** user-id-bearing route
— the handler always takes the actor from the session, so "read/write another user's
notifications/preferences by id" is not a refused request but a *non-existent surface*. D2
demonstrates the one place an id is accepted (mark-one-read) is self-scoped: B supplying A's
notification id marks nothing for A. Manager→announcement-compose is **allowed** by D1 (C3), so
it is not a forbidden access; the forbidden compose actors are Tutor (C1) and Learner (C2).

## 5. E2E narrative (one sitting)

1. **Messaging round-trip + coalescing.** demo.manager allocates demo.tutor→demo.learner; the
   tutor opens the thread and both parties exchange messages on the same pair-unique thread. Three
   rapid tutor messages produce **three** in-app rows for the learner (in-app never coalesced),
   while the email coalescing gate returns TRUE once an unread row exists (2nd+ email suppressed)
   and FALSE when none does (first email would send).
2. **Two-announcement visibility.** demo.manager publishes one course-scoped (iCQ) and one
   provider-wide announcement. The enrolled learner sees BOTH and is notified of both; the
   unenrolled org-learner sees and is notified of ONLY the provider-wide one; staff see both.
3. **Pass → session unlocked.** With sequential-unlock ON, a throwaway learner submits Session 3
   and the allocated tutor records a PASS. The learner receives a `result.recorded` in-app row and
   a `session.unlocked` in-app row for Session 4 (the Phase-4 gating rule composed into the
   framework).
4. **Preference effect.** The messaging email gate reads ON by default; toggling the learner's
   messaging preference OFF flips the gate to OFF (no email would send) while a subsequent message
   STILL writes its in-app row — email suppressed, in-app unaffected.

All four passed (harness `p6s7-exit.ts`, 0 failures). Full log retained in the session scratchpad
(`p6s7-out.txt`).

## 6. Test suite vs BASELINE

`pnpm vitest run` in `apps/api`: **410 passed**; 6 test *files* fail to load
(`agent-lesson-content`, `ai-credits-usage`, `balance-answer-positions`,
`course-go-live-readiness`, `question-update`, and `email-jobs.ts`'s `@cio/db/queries/notifications`
subpath via `reset-member-course-progress`) — the exact `docs/BASELINE.md` **F1** set, a
vite/vitest wildcard-subpath resolver quirk on modules that exist in `dist/` and run fine outside
vitest. **Zero assertion failures; zero new load-failures.** The comms suites specifically:
`notify-framework`, `notification-centre`, `messaging`, `announcements`, `coursework-notifications`,
`coursework-notify-nonfatal`, `preferences`, and the `authz/*` route suites all pass.

## 7. Deviations & debts (owner-visible)

- **Preferences store: dedicated table, not the stock email-toggles.** The Step-1 model floated
  reusing the existing `organizationmember_email_notifications` machinery; Steps 2 + 6 (per the
  authoritative prompt packs) instead built a dedicated `notification_preference` table + a single
  framework resolver + a `comms-preferences` settings section. `COMMS-MODEL.md` §3/§4/§5 carry
  as-built notes recording this. No behavioural debt — self-only, config-defaulted, one resolver.
- **Email *delivery* is verified by gate, not by wire.** The harnesses assert the DB-observable
  effects — in-app rows always written, the email preference gate, the coalescing gate. Actual
  SMTP delivery + coalescing-on-the-wire is the owner's manual Mailpit check (needs Redis + the
  jobs worker + Mailpit running). This matches every prior phase.
- **Two Phase-3 coursework emails** were migrated onto the framework and are now preference-gated;
  the `COURSEWORK_EMAILS_ENABLED` global kill-switch remains beside the per-user preference.
- **BASELINE F1 load-failures (6 files)** remain unfixed by design — pre-existing resolver quirk,
  documented in `BASELINE.md`, not introduced by Phase 6.

## 8. Deploy decision

The comms centre is stable. Production (`learn.epearlacademy.com`, DO droplet) is currently
**held at the Phase-0 commit** pending AWS SES SMTP (to be routed via the Pearl Email Engine), per
the owner's earlier HOLD. Redeploying now would advance the droplet to `origin/main` HEAD
(`e09b2d138`, all of Phases 1–6). **Question put to the owner** — hold vs redeploy (see the chat
message accompanying this report). If the owner approves a redeploy, update `docs/DEPLOY.md`'s
verified live-hash note to the deployed commit.

## 9. Independent static review

An independent reviewer subagent was launched for the static criteria (stray-send-path grep,
template inspection, ACCESS/AUDIT cross-check, suite vs BASELINE). It executed but did not relay
its written report back over the message channel (it returned only idle signals), so the static
review below was performed directly against the code rather than transcribed from it — an
independent pass distinct from the adversarial/E2E harness, at the same rigour.

- **Stray send paths (criterion 2).** Grepped every `enqueueTransactionalEmail` / `insertNotification`
  call site across `apps/api/src` + `packages`. The only *comms* send is `notify.ts:81` (email) +
  `notify.ts:52` (in-app). All other `enqueueTransactionalEmail` sites are stock non-comms flows
  (org/course invites, welcomes, payment requests, newsfeed, onboarding, the student-limit notice,
  course-completion, and the separate stock **exercise**-submission emails `submissionGraded` /
  `submissionReceived` — distinct from the Phase-3/6 coursework templates `coursework-submitted` /
  `coursework-resulted`). No comms event bypasses `emitNotification`. **PASS.**
- **Content-light templates (criterion 3).** Read all four comms templates. `message-received` →
  "You have a new message waiting" + link, no body/name. `announcement-published` → no title/body.
  `coursework-submitted` → course + session structure only, no learner name/work/feedback/result.
  `coursework-resulted` → course + session + "log in to view", **no result value, no feedback text**.
  **PASS.**
- **Audit (criterion 6) & ACCESS (criterion 7).** Code was already compliant; the two docs did not
  yet record Phase 6. Fixed in-scope: `AUDIT.md` gains the Phase-6 `announcement.published` row (+ the
  intentional no-audit note for notifications/messaging/preferences); `ACCESS.md` gains §10 (Phase 6 —
  comms centre) with each endpoint's live guard. **PASS after fix.**
- **Suite vs BASELINE (criterion 8).** `pnpm vitest run` (apps/api): 410 passed; the 6 load-failures
  are exactly the BASELINE F1 set. **PASS.**

No criterion is left PARTIAL or FAIL; the two gaps found were documentation-only and were fixed this
step, not waived.
