type EnvLike = Record<string, string | undefined>;

/**
 * Scalability Phase F kill switch. When true (the default) the learner-progress readers — course progress,
 * the completion rule, the sequential-unlock walk and the material-download guard — resolve "which units has
 * this learner passed" in ONE batched read per course (getPassedLessonIdsForLearnerCourse) instead of ~2
 * queries per unit (hasLearnerPassedUnit). The two paths are proven equivalent by an old-vs-new suite; set
 * PROGRESS_BATCHED=false (or 0/off/no) to fall back to the per-unit helper without a code change.
 * Read at call time, so a restart with the new env is the only step needed.
 */
export function isProgressBatched(env?: EnvLike): boolean {
  const source = env ?? (globalThis as { process?: { env?: EnvLike } }).process?.env ?? {};
  const raw = source.PROGRESS_BATCHED?.trim().toLowerCase();
  return !(raw === 'false' || raw === '0' || raw === 'off' || raw === 'no');
}
