// PearlLMS feature switches. Single source of truth for hiding upstream ClassroomIO features that the
// self-hosted deployment does not use.
//
// AI: the owner has disabled every ClassroomIO AI surface (Ask-AI bar + Ctrl+I, course "AI Assistant",
// "Summarize lesson", note "Quote in chat", AI Tutor / AI Credits settings, the org AI course creator,
// the authoring "AI generate" buttons, MCP automation, AI transcript generation). Flip this to `true` to
// bring them all back — every AI surface is gated on this one constant, nothing was deleted.
export const AI_ENABLED = false;
