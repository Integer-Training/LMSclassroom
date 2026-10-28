import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase I (upload-presign-abuse-and-orphans) — a video recording's declared size is capped by the question's max
// duration x a generous bitrate (with a floor), at both init and complete. The Supabase bucket limit stays the hard stop.

vi.mock('@cio/core/config/storage', () => ({ getStorageConfig: () => ({ presignUploadExpiresSeconds: 3600 }) }));
vi.mock('@cio/core/utils/s3', () => ({
  generateVideoDownloadPresignedUrls: vi.fn(),
  generateVideoUploadPresignedUrl: vi.fn(async () => 'https://upload.test/put')
}));
vi.mock('@cio/db/queries/assets', () => ({
  createAsset: vi.fn(async () => ({ id: 'asset-1' })),
  getAssetById: vi.fn(async () => ({ id: 'asset-1', storageKey: 'k', metadata: {} })),
  updateAsset: vi.fn()
}));
vi.mock('@cio/db/queries/exercise', () => ({ getExerciseWithRelationsOptimized: vi.fn() }));
vi.mock('@cio/db/queries/submission', () => ({
  getQuestionAnswersBySubmissionId: vi.fn(),
  getSubmissionById: vi.fn()
}));
vi.mock('@cio/db/queries/group', () => ({ getGroupMemberIdByCourseAndProfile: vi.fn(async () => 42) }));
vi.mock('@cio/db/queries/course/people', () => ({ getProfileByGroupMemberId: vi.fn() }));
vi.mock('@cio/db/queries/tag', () => ({ getCourseOrganizationId: vi.fn(async () => 'org-1') }));
vi.mock('@api/middlewares/guards', () => ({ isAllocatedTutor: vi.fn() }));

import { getExerciseWithRelationsOptimized } from '@cio/db/queries/exercise';
import { createAsset } from '@cio/db/queries/assets';
import {
  completeVideoRecordingUpload,
  getVideoRecordingMaxBytes,
  initVideoRecordingUpload
} from '@api/services/exercise/video-recording';
import { QUESTION_TYPE_IDS } from '@cio/question-types';

const MB = 1024 * 1024;

function mockQuestion(maxDurationSeconds: number) {
  vi.mocked(getExerciseWithRelationsOptimized).mockResolvedValue({
    questions: [{ id: 7, questionTypeId: QUESTION_TYPE_IDS.VIDEO_RECORDING, settings: { maxDurationSeconds } }]
  } as never);
}

const initInput = (size: number) => ({ fileName: 'a.webm', mimeType: 'video/webm' as const, size });
const completeInput = (size: number, durationSeconds = 30) => ({
  assetId: '00000000-0000-4000-8000-000000000000',
  storageKey: 'k',
  fileName: 'a.webm',
  mimeType: 'video/webm' as const,
  size,
  durationSeconds,
  recordedAt: new Date().toISOString()
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getVideoRecordingMaxBytes', () => {
  it('scales with the max duration at 10 Mbps, with a 10 MB floor', () => {
    expect(getVideoRecordingMaxBytes(60)).toBe(62 * 1_250_000);
    expect(getVideoRecordingMaxBytes(120)).toBe(122 * 1_250_000);
    expect(getVideoRecordingMaxBytes(1)).toBe(10 * MB);
  });
});

describe('recording size cap', () => {
  it('init: a size within the cap proceeds to a presigned upload', async () => {
    mockQuestion(60);
    const result = await initVideoRecordingUpload('c1', 'ex1', 7, 'p1', initInput(40 * MB));
    expect(result.assetId).toBe('asset-1');
  });

  it('init: an oversized declared size is a 413 and no asset row / presigned URL is created', async () => {
    mockQuestion(60);
    await expect(initVideoRecordingUpload('c1', 'ex1', 7, 'p1', initInput(500 * MB))).rejects.toMatchObject({
      statusCode: 413
    });
    expect(createAsset).not.toHaveBeenCalled();
  });

  it('complete: an oversized declared size is a 413', async () => {
    mockQuestion(60);
    await expect(completeVideoRecordingUpload('c1', 'ex1', 7, 'p1', completeInput(500 * MB))).rejects.toMatchObject({
      statusCode: 413
    });
  });

  it('complete: a normal recording still completes', async () => {
    mockQuestion(60);
    const answer = await completeVideoRecordingUpload('c1', 'ex1', 7, 'p1', completeInput(20 * MB));
    expect(answer).toMatchObject({ type: 'VIDEO_RECORDING', size: 20 * MB });
  });
});
