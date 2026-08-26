import { createHash } from 'crypto';
import { nanoid } from 'nanoid';
import path from 'path';

/**
 * Safely extracts the file extension from a filename.
 * Returns an empty string if no extension is found.
 */
export function getExtension(filename: string): string {
  if (!filename || typeof filename !== 'string') return '';
  const ext = path.extname(filename).split('.');
  return ext.length > 1 ? ext[ext.length - 1] : '';
}

export function removeSpacesAndSpecialCharacters(fileName: string): string {
  return fileName
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9.-]/g, '')
    .toLowerCase();
}

/**
 * Generates a unique file key for storage, preserving the file extension.
 * Throws an error if the filename is invalid or has no extension.
 */
export function generateFileKey(fileName: string): string {
  const ext = getExtension(fileName);
  if (!ext) {
    throw new Error('Invalid file name or missing file extension');
  }

  const cleanedFileName = removeSpacesAndSpecialCharacters(fileName);

  return `${nanoid()}-${cleanedFileName}`;
}

/**
 * Key for an admin-authored unit MATERIAL (PearlLMS Phase 2 Step 4). Namespaces the object under a
 * per-course `materials/` prefix so Phase 3 learner coursework can live cleanly alongside (reserve
 * `coursework/{courseId}/{learnerId}/…`; not built here). The prefix is organizational — access
 * control is enforced by the guarded download binding, not by the key path.
 */
export function generateMaterialFileKey(courseId: string, fileName: string): string {
  return `materials/${courseId}/${generateFileKey(fileName)}`;
}

/**
 * Short, stable, filesystem-safe slug for an assessment item, derived from its lesson.documents[].key.
 * The raw key contains slashes/nanoids; this hashes it to a fixed 16-hex-char segment so it can namespace
 * a coursework prefix without leaking or nesting the raw key. Deterministic (same key → same slug).
 */
export function courseworkAssessmentSlug(assessmentKey: string): string {
  return createHash('sha256').update(assessmentKey).digest('hex').slice(0, 16);
}

/**
 * Object-key prefix for a learner's coursework on one unit + ASSESSMENT + VERSION (PearlLMS Phase 3 Step
 * 4; Phase 8 per-assessment). Learner-, unit-, and assessment-scoped:
 * `coursework/{courseId}/{learnerId}/{lessonId}/{assessmentSlug}/{version}/…`. The prefix is organizational
 * only — access is enforced by the guarded coursework-download binding (assertCourseworkDownloadAccess),
 * never by the path. The server reconstructs this exact prefix from the authenticated actor + path +
 * validated assessment when a submission is created, so a learner can only register keys under their OWN
 * prefix (blocks key injection / cross-learner references), and one assessment's version namespace never
 * collides with another's.
 */
export function courseworkKeyPrefix(
  courseId: string,
  learnerId: string,
  lessonId: string,
  assessmentKey: string,
  version: number
): string {
  return `coursework/${courseId}/${learnerId}/${lessonId}/${courseworkAssessmentSlug(assessmentKey)}/${version}/`;
}

/** Key for one coursework file in a given submission version (see courseworkKeyPrefix). */
export function generateCourseworkFileKey(
  courseId: string,
  learnerId: string,
  lessonId: string,
  assessmentKey: string,
  version: number,
  fileName: string
): string {
  return `${courseworkKeyPrefix(courseId, learnerId, lessonId, assessmentKey, version)}${generateFileKey(fileName)}`;
}
