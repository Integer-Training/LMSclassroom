import type { Actor } from '@cio/db/actor';
import { AppError, ErrorCodes } from '@api/utils/errors';
import { zipDocumentObjects } from '@cio/core/utils/zip';
import { getAssessmentSubmissions } from '@api/services/caseload/course-view';

// PearlLMS — "Download all submissions" for one workbook. Reuses getAssessmentSubmissions (so the exact
// same access scope applies: allocated∩enrolled for a tutor, all-enrolled for admin), then zips each
// learner's LATEST submission files (named per learner) via the core zip util.

function sanitize(name: string): string {
  // Strip anything but a safe charset, then remove any leading dots so a name/filename can never reduce to
  // "." or ".." (Zip Slip). A result that's empty or still dot-only falls back to a fixed label.
  const cleaned = (name || '')
    .replace(/[^a-zA-Z0-9 ._-]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 80);
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'unknown';
}

export async function buildAssessmentSubmissionsZip(
  actor: Actor,
  courseId: string,
  lessonId: string,
  assessmentKey: string
): Promise<{ filename: string; buffer: Buffer }> {
  const grid = await getAssessmentSubmissions(actor, courseId, lessonId, assessmentKey);

  const entries: { path: string; key: string }[] = [];
  const usedFolders = new Map<string, number>();
  for (const row of grid.rows) {
    if (row.files.length === 0) continue;
    let folder = sanitize(row.learner.name);
    const seen = usedFolders.get(folder) ?? 0;
    usedFolders.set(folder, seen + 1);
    if (seen > 0) folder = `${folder} (${seen + 1})`; // de-dupe same display names
    for (const file of row.files) {
      entries.push({ path: `${folder}/${sanitize(file.name)}`, key: file.key });
    }
  }

  const { buffer, added } = await zipDocumentObjects(entries);
  if (added === 0) {
    throw new AppError('No submitted files to download for this assessment', ErrorCodes.NOT_FOUND, 404);
  }
  return { filename: `${sanitize(grid.assessmentName)}-submissions.zip`, buffer };
}
