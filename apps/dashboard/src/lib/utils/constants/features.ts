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
