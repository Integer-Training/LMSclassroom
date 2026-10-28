# Scalability baseline (Phase 0) — prod, 2026-10-28, before any scalability change (deployed commit ad92abcf5)

Supabase cvtmymxxjgjshrzsjxnj, PG 17.6, max_connections 60. 1 org, 40 learners, 5 tutors, 2 courses.

Row counts: session 202 (120 expired), verification 8, groupmember 52, coursework_submission 7, notification 30,
message 12 / threads 12, analytics_page_event 0, system_event_log 170, dead_letter_job 26, audit_event 207.
Duplicate pending registrations (org,email): 0 → partial unique index is safe.

pg_stat_statements (cumulative, top by calls):
| calls | query |
|---|---|
| 666,726 | BEGIN / set_config(role, jwt…) / COMMIT — Supabase Storage API per-request wrapper |
| 351,054 | organization row select (by siteName/domain) |
| 335,817 | select id from organization order by created_at limit 1 (getFirstOrg) |
| 335,816 | organization + fields select |
| 332,741 | organization_plan select |
| 166,284 ×2 | storage.objects lookups (COLLATE "C") — Storage API object HEAD/GET |
| 111,840 | organizationmember by profile_id (customSession) |
| 111,328 | profile.status (customSession) |
| 90,938 | organizationmember JOIN profile (resolveActor) |
| 47,9xx | better-auth session by token / user by id |
| 33,179 | update session set updated_at (heartbeat) |
| 26,513 | unread notification count (bell poll) |

Targets after Phases A–J: org/plan/getFirstOrg queries per page view ≈ 0; identity queries per API request 3 → 1;
storage lookups drop with the per-navigation OG warm fetch removed; session writes ≤ 1 per 45 s per session.
