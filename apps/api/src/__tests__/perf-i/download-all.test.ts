import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// Phase I (download-all-zip-in-memory) — buildAssessmentSubmissionsZip does every refusal BEFORE streaming starts
// (empty -> 404, over 200 files / 250 MB -> 413), de-duplicates names (a silent overwrite is data loss), keeps the
// Zip Slip sanitising and the "(2)" folder de-dupe, and hands a stream (not a buffer) to the route.

vi.mock('@api/services/caseload/course-view', () => ({ getAssessmentDownloadFiles: vi.fn() }));
vi.mock('@cio/core/utils/zip', () => ({
  createDocumentZipStream: vi.fn(() => new ReadableStream()),
  ZIP_MAX_FILES: 200,
  ZIP_MAX_TOTAL_BYTES: 250 * 1024 * 1024
}));

import { getAssessmentDownloadFiles } from '@api/services/caseload/course-view';
import { createDocumentZipStream } from '@cio/core/utils/zip';
import { buildAssessmentSubmissionsZip } from '@api/services/caseload/download-all';

const mFiles = vi.mocked(getAssessmentDownloadFiles);
const mStream = vi.mocked(createDocumentZipStream);

const actor: Actor = { authenticated: true, userId: 'u', role: 'ADMIN', status: 'ACTIVE', orgId: 'o' };
const learner = (id: string, name: string, files: { key: string; name: string; size?: number }[]) => ({
  learnerId: id,
  name,
  files
});
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 0;
  } catch (e) {
    return (e as { statusCode?: number }).statusCode ?? -1;
  }
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildAssessmentSubmissionsZip', () => {
  it('no files at all -> 404 before any stream is created', async () => {
    mFiles.mockResolvedValue({ assessmentName: 'WB', learners: [] });
    expect(await code(buildAssessmentSubmissionsZip(actor, 'c', 'l', 'wb'))).toBe(404);
    expect(mStream).not.toHaveBeenCalled();
  });

  it('more than 200 files -> 413 with the per-learner guidance, no stream', async () => {
    const files = Array.from({ length: 201 }, (_, i) => ({ key: `k${i}`, name: `f${i}.pdf` }));
    mFiles.mockResolvedValue({ assessmentName: 'WB', learners: [learner('L1', 'Ann', files)] });
    await expect(buildAssessmentSubmissionsZip(actor, 'c', 'l', 'wb')).rejects.toMatchObject({
      statusCode: 413,
      message: expect.stringContaining('per learner')
    });
    expect(mStream).not.toHaveBeenCalled();
  });

  it('exactly 200 files is allowed', async () => {
    const files = Array.from({ length: 200 }, (_, i) => ({ key: `k${i}`, name: `f${i}.pdf` }));
    mFiles.mockResolvedValue({ assessmentName: 'WB', learners: [learner('L1', 'Ann', files)] });
    await buildAssessmentSubmissionsZip(actor, 'c', 'l', 'wb');
    expect(mStream).toHaveBeenCalledTimes(1);
  });

  it('declared total over 250 MB -> 413', async () => {
    mFiles.mockResolvedValue({
      assessmentName: 'WB',
      learners: [
        learner('L1', 'Ann', [{ key: 'a', name: 'a.pdf', size: 200 * 1024 * 1024 }]),
        learner('L2', 'Bob', [{ key: 'b', name: 'b.pdf', size: 60 * 1024 * 1024 }])
      ]
    });
    expect(await code(buildAssessmentSubmissionsZip(actor, 'c', 'l', 'wb'))).toBe(413);
    expect(mStream).not.toHaveBeenCalled();
  });

  it('returns a stream (not a buffer) and a sanitised filename', async () => {
    mFiles.mockResolvedValue({
      assessmentName: 'Work/book: 1?',
      learners: [learner('L1', 'Ann', [{ key: 'k', name: 'a.pdf' }])]
    });
    const result = await buildAssessmentSubmissionsZip(actor, 'c', 'l', 'wb');
    expect(result.stream).toBeInstanceOf(ReadableStream);
    expect(result.filename).toBe('Workbook 1-submissions.zip');
  });

  it('de-duplicates same-named files inside one learner folder instead of overwriting', async () => {
    mFiles.mockResolvedValue({
      assessmentName: 'WB',
      learners: [
        learner('L1', 'Ann', [
          { key: 'k1', name: 'report.pdf' },
          { key: 'k2', name: 'report.pdf' },
          { key: 'k3', name: 'Report.PDF' },
          { key: 'k4', name: 'notes' },
          { key: 'k5', name: 'notes' }
        ])
      ]
    });
    await buildAssessmentSubmissionsZip(actor, 'c', 'l', 'wb');
    const entries = mStream.mock.calls[0][0];
    expect(entries.map((e) => e.path)).toEqual([
      'Ann/report.pdf',
      'Ann/report (2).pdf',
      'Ann/Report (3).PDF',
      'Ann/notes',
      'Ann/notes (2)'
    ]);
    expect(new Set(entries.map((e) => e.path.toLowerCase())).size).toBe(entries.length);
  });

  it('keeps the "(2)" folder de-dupe for learners sharing a display name', async () => {
    mFiles.mockResolvedValue({
      assessmentName: 'WB',
      learners: [
        learner('L1', 'Sam Lee', [{ key: 'k1', name: 'a.pdf' }]),
        learner('L2', 'Sam Lee', [{ key: 'k2', name: 'a.pdf' }]),
        learner('L3', 'sam lee', [{ key: 'k3', name: 'a.pdf' }])
      ]
    });
    await buildAssessmentSubmissionsZip(actor, 'c', 'l', 'wb');
    expect(mStream.mock.calls[0][0].map((e) => e.path)).toEqual([
      'Sam Lee/a.pdf',
      'Sam Lee (2)/a.pdf',
      'sam lee (3)/a.pdf'
    ]);
  });

  it('Zip Slip: traversal / dot-only / empty names can never escape the learner folder', async () => {
    mFiles.mockResolvedValue({
      assessmentName: 'WB',
      learners: [
        learner('L1', '../../etc', [
          { key: 'k1', name: '../../evil.pdf' },
          { key: 'k2', name: '..' },
          { key: 'k3', name: '' }
        ])
      ]
    });
    await buildAssessmentSubmissionsZip(actor, 'c', 'l', 'wb');
    for (const e of mStream.mock.calls[0][0]) {
      expect(e.path).not.toContain('..');
      expect(e.path.startsWith('/')).toBe(false);
      expect(e.path.split('/')).toHaveLength(2);
    }
  });

  it('passes declared sizes through so the zip can budget its prefetch', async () => {
    mFiles.mockResolvedValue({
      assessmentName: 'WB',
      learners: [learner('L1', 'Ann', [{ key: 'k1', name: 'a.pdf', size: 1234 }])]
    });
    await buildAssessmentSubmissionsZip(actor, 'c', 'l', 'wb');
    expect(mStream.mock.calls[0][0][0]).toMatchObject({ key: 'k1', size: 1234 });
  });
});
