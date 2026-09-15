// PearlLMS feature switches. Single source of truth for hiding upstream ClassroomIO features that the
// self-hosted deployment does not use.
//
// AI: the owner has disabled every ClassroomIO AI surface (Ask-AI bar + Ctrl+I, course "AI Assistant",
// "Summarize lesson", note "Quote in chat", AI Tutor / AI Credits settings, the org AI course creator,
// the authoring "AI generate" buttons, MCP automation, AI transcript generation). Flip this to `true` to
// bring them all back — every AI surface is gated on this one constant, nothing was deleted.
export const AI_ENABLED = false;

// EXPLORE: the learner "Explore" catalogue (browse + self-enrol into public courses) is meaningless in this
// closed, invite-only deployment — enrolment is staff-provisioned, there is no public course catalogue. The
// nav item, the /lms/explore route (redirects to /lms) and the "Find courses" link are all gated on this.
export const EXPLORE_ENABLED = false;

// COHORTS: ClassroomIO's scheduled cohort feature is unused here — apprenticeship learners are enrolled
// directly via staff allocation, not cohort runs. Nav item + /lms/cohorts route gated on this.
export const COHORTS_ENABLED = false;

// COMMUNITY: the learner community/forum is off for now (low expected use). Nav item + /lms/community route
// gated on this. Flip to true (and the org community customization flag) to bring it back.
export const COMMUNITY_ENABLED = false;

// CERTIFICATES: PearlLMS issues certificates off-platform / manually, so the learner certificates page is
// empty and hidden. Nav item + /lms/certificates route gated on this.
export const CERTIFICATES_ENABLED = false;

// ---------------------------------------------------------------------------
// ORG (admin) sidebar switches. Same reversible pattern — these hide upstream
// ClassroomIO admin surfaces the apprenticeship deployment does not use. Each
// only removes the sidebar link / settings tab; flip to `true` to restore.
// ---------------------------------------------------------------------------

// ORG_HOME: the admin "Home" landing tile page is redundant here (admins work from Courses / People /
// Broadcasts). Hides the "Home" nav item on /org/[slug] (and the same sidebar on /org/[slug]/setup).
export const ORG_HOME_ENABLED = false;

// TAGS: audience tagging is unused in the closed apprenticeship model. Hides the org "Tags" nav item.
export const TAGS_ENABLED = false;

// WIDGETS: embeddable course widgets have no place in the private LMS. Hides the org "Widgets" nav item.
export const WIDGETS_ENABLED = false;

// API_ACCESS: the public REST API surface is not exposed for this deployment. Hides the "API" nav item.
export const API_ACCESS_ENABLED = false;

// ZAPIER: no Zapier integration is used. Hides the "Zapier" nav item.
export const ZAPIER_ENABLED = false;

// LANDING_PAGE: the org public landing-page builder is unused (invite-only, no marketing site). Hides the
// Settings → "Landing page" tab.
export const LANDING_PAGE_ENABLED = false;

// BILLING: self-hosted deployment has no in-app billing. Hides the Settings → "Billing" tab.
export const BILLING_ENABLED = false;

// The generic "Audience", "Users" and "Tutor allocation" admin nav items are REPLACED by the richer
// Learner Management / Tutor Management pages (which fold their function in). Hidden from the sidebar; the
// underlying routes stay reachable by URL. Flip to `true` to bring an old item back.
export const AUDIENCE_NAV_ENABLED = false;
export const LEGACY_USERS_NAV_ENABLED = false;
export const LEGACY_ALLOCATION_NAV_ENABLED = false;
