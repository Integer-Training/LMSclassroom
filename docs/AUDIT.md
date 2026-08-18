# AUDIT.md — audit trail conventions

PearlLMS keeps **one shared audit trail** — the `audit_event` table — for sensitive actions
(user management + profile edits from Phase 1; results, allocations, and registration
approvals in later phases). One table, not per-feature tables. Written only through
`recordAudit()` (`@cio/db/audit`).

## Table — `audit_event` (`packages/db/src/schema.ts`)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid (pk, default random) | |
| `occurred_at` | timestamptz (default now) | when it happened |
| `actor_user_id` | uuid, nullable | who did it (null = system/background) |
| `organization_id` | uuid, nullable | org scope (from the actor unless overridden) |
| `action` | text | dot-namespaced, e.g. `user.role_changed` |
| `entity_type` | text | the thing acted on, e.g. `user`, `profile` |
| `entity_id` | text, nullable | its id |
| `metadata` | jsonb (default `{}`) | identifiers + changed-field NAMES only — **never PII values** |

**No foreign keys** — audit rows must survive deletion of the actor, org, or entity.

## Action-name convention

`<entity>.<verb_in_past_tense>`, lower_snake_case, dot-separated — e.g. `user.created`,
`user.role_changed`, `profile.updated`. Defined once in `AUDIT_ACTIONS` (`@cio/utils/auth`);
call-sites use the constant, not a string literal.

## The no-PII-in-metadata rule (HARD)

`metadata` records **identifiers and changed-field NAMES**, never the personal-data VALUES.

- ✅ `{ fields: ["ni_number", "address"], role_from: 3, role_to: 2 }`
- ❌ `{ ni_number: "QQ123456C", address: "12 High St", email: "a@b.com" }`

Enforced three ways:
1. **Convention + review** — the primary control; audit metadata is small and deliberate.
2. **`sanitizeAuditMetadata` in `recordAudit`** — strips any PII-named key holding a scalar
   value (a value, not a field-name list) before the row is written, and logs a warning so
   the bug surfaces in dev. It never throws (an audit write must not break the business
   action). Field-name lists (arrays) pass through untouched.
3. **`assertAuditMetadataSafe`** — the throwing variant, used in tests to prove disallowed
   shapes are rejected.

Never put passwords, tokens, emails, names, phone numbers, addresses, NI numbers, DOB, etc.
as metadata *values*. Record the field name that changed instead.

## `recordAudit()` — the only writer

```ts
import { recordAudit, AUDIT_ACTIONS } from '@cio/db/audit';

await recordAudit({
  actor,                         // the resolved Actor (or { userId, orgId } for system actions)
  action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
  entityType: 'user',
  entityId: targetUserId,
  metadata: { role_from: 3, role_to: 2 } // ids + field names only
});
```

Best-effort: failures are logged and swallowed. `actor_user_id` + `organization_id` are taken
from the `Actor`; pass `organizationId` to override.

## Phase 1 actions (wired in Steps 6–7 — NOT yet)

| Action | When | Entity | Example metadata |
|---|---|---|---|
| `user.created` | admin creates/invites a user | `user` | `{ role: 3, invited: true }` |
| `user.role_changed` | admin changes a user's role | `user` | `{ role_from, role_to }` |
| `user.status_changed` | admin activates/deactivates a user | `user` | `{ status_from, status_to }` |
| `profile.updated` | a profile is edited | `profile` | `{ fields: ["fullname", "locale"] }` |

Call-sites are added by the steps that own each action — Step 3 only ships the table + helper.

## Phase 3–5 actions (wired)

| Action | When | Entity | Example metadata |
|---|---|---|---|
| `allocation.created` | manager/admin allocates a tutor to a learner | `tutor_allocation` | `{ tutorId, learnerId }` (ids only) |
| `allocation.removed` | manager/admin removes an allocation | `tutor_allocation` | `{ allocationId }` |
| `coursework.submitted` | a learner submits coursework | `coursework_submission` | `{ submissionId, version, fileCount }` |
| `result.entered` | a tutor records a Pass/Refer | `coursework_result` | `{ submissionId, version, result }` — NEVER the feedback text |
| `completion.recorded` | the final required Pass completes a course (Phase 5) | `course_completion` | `{ learnerId, courseId, completionId }` (ids only) |

**Lite onboarding (Phase 5 Step 5) adds NO new audit action.** It composes Phase 1's `createOrgUser`, so the
account creation is recorded by the existing **`user.created`** (id-only metadata). The enrolment write is not
independently audited (it mirrors the existing course-enrolment path, which is unaudited).

## Phase 6 actions (wired)

| Action | When | Entity | Example metadata |
|---|---|---|---|
| `announcement.published` | admin/manager publishes an announcement (course-scoped or provider-wide) | `announcement` | `{ announcementId, scope, courseId }` (ids only — NEVER the title or body) |

**Notifications, messaging and preference changes are intentionally NOT audited.** They are self-only
operational state with no privileged-decision value: in-app notification rows and read cursors, per-user
message sends within an already-audited allocation, and a user toggling their own email preference. Auditing
them would add per-message/per-read PII-adjacent volume for no oversight benefit. The privileged decisions
around comms *are* audited elsewhere — the allocation that authorises a thread (`allocation.created` /
`allocation.removed`) and the announcement publish above.
