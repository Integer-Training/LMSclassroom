import type { Actor } from '@cio/db/actor';
import { AppError, ErrorCodes } from '@api/utils/errors';
import { createDocumentZipStream, ZIP_MAX_FILES, ZIP_MAX_TOTAL_BYTES, type ZipEntry } from '@cio/core/utils/zip';
import { getAssessmentDownloadFiles } from '@api/services/caseload/course-view';

// PearlLMS — "Download all submissions" for one workbook. Reads each in-scope learner's LATEST submission files
// through getAssessmentDownloadFiles (the same access scope as the grid: allocated∩enrolled for a tutor,
// all-enrolled for admin, empty roster = 404), applies the size pre-checks, then STREAMS the zip (core zip util —
// never buffered whole). Every refusal happens here, before the route sends a single header.

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

/** "report.pdf" taken twice in one folder -> "report.pdf", "report (2).pdf" (never a silent overwrite). */
function uniqueFileName(name: string, used: Set<string>): string {
  let candidate = name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export async function buildAssessmentSubmissionsZip(
  actor: Actor,
  courseId: string,
  lessonId: string,
  assessmentKey: string
): Promise<{ filename: string; stream: ReadableStream<Uint8Array> }> {
  const { assessmentName, learners } = await getAssessmentDownloadFiles(actor, courseId, lessonId, assessmentKey);

  const entries: ZipEntry[] = [];
  const usedFolders = new Map<string, number>();
  let declaredBytes = 0;
  for (const learner of learners) {
    const base = sanitize(learner.name);
    const seen = usedFolders.get(base.toLowerCase()) ?? 0;
    usedFolders.set(base.toLowerCase(), seen + 1);
    const folder = seen > 0 ? `${base} (${seen + 1})` : base; // de-dupe same display names
    const usedNames = new Set<string>();
    for (const file of learner.files) {
      entries.push({
        path: `${folder}/${uniqueFileName(sanitize(file.name), usedNames)}`,
        key: file.key,
        size: file.size
      });
      declaredBytes += file.size ?? 0;
    }
  }

  if (entries.length === 0) {
    throw new AppError('No submitted files to download for this assessment', ErrorCodes.NOT_FOUND, 404);
  }
  if (entries.length > ZIP_MAX_FILES || declaredBytes > ZIP_MAX_TOTAL_BYTES) {
    throw new AppError(
      `Too many files to download at once (limit ${ZIP_MAX_FILES} files / ${ZIP_MAX_TOTAL_BYTES / 1024 / 1024} MB). Download submissions per learner instead.`,
      'FILE_TOO_LARGE',
      413
    );
  }

  return { filename: `${sanitize(assessmentName)}-submissions.zip`, stream: createDocumentZipStream(entries) };
}
