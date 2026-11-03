import axios from 'axios';
import { classroomio } from '$lib/utils/services/api';
import { BaseApi } from '$lib/utils/services/api/base.svelte';
import { snackbar } from '$features/ui/snackbar/store';
import { GenericUploader } from '$lib/utils/services/courses/presign';

export interface CourseworkFile {
  key: string;
  name: string;
  size?: number;
  type?: string;
}

export interface CourseworkSubmission {
  id: string;
  learnerId: string;
  courseId: string;
  lessonId: string;
  /** The assessment item this answers (Phase 8), or null for legacy unit-level rows. */
  assessmentKey: string | null;
  /** 'final' (graded Pass/Refer) | 'draft' (feedback-only). */
  submissionType: string;
  version: number;
  files: CourseworkFile[];
  /** The learner's optional note attached to this submission. */
  comment: string | null;
  status: string;
  submittedAt: string;
  /** 'verdict' | 'draft' | null (unmarked). */
  resultKind: string | null;
  /** The tutor's verdict on a FINAL version (Pass/Refer), or null (unmarked / draft). */
  result: string | null;
  /** The tutor's written feedback for this version, or null. */
  feedback: string | null;
  /** The tutor's uploaded feedback files (marked-up workbook) — the learner may download their own. */
  feedbackFiles: CourseworkFile[];
}

// Allowed document types + limit mirror the server config (validation/constants + upload-limits). The
// server re-validates authoritatively; this is just fast, clear feedback before the upload starts.
const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword'
];

/**
 * Learner coursework upload (PearlLMS Phase 3 Step 4). Flow per file: request a presigned URL (server
 * computes the version + a learner-scoped key), PUT the bytes straight to the private bucket, then
 * register the keys as one versioned submission. Reads/downloads are all re-guarded server-side; a key
 * alone never grants access.
 */
class CourseworkApi extends BaseApi {
  submissions = $state<CourseworkSubmission[]>([]);
  canSubmit = $state(true);
  // Upload state is per assessment item (lessonId:assessmentKey) — one card's failure must not show on the others.
  uploading = $state<Record<string, boolean>>({});
  uploadErrors = $state<Record<string, string>>({});
  lastSubmitted = $state<CourseworkSubmission | null>(null);
  loadedLessonId = $state<string | null>(null);
  private inflight: { lessonId: string; promise: Promise<unknown> } | null = null;

  private itemKey(lessonId: string, assessmentKey: string) {
    return `${lessonId}:${assessmentKey}`;
  }

  isUploadingFor(lessonId: string, assessmentKey: string) {
    return !!this.uploading[this.itemKey(lessonId, assessmentKey)];
  }

  uploadErrorFor(lessonId: string, assessmentKey: string) {
    return this.uploadErrors[this.itemKey(lessonId, assessmentKey)] ?? null;
  }

  private base(courseId: string, lessonId: string) {
    return classroomio.course[':courseId'].lesson[':lessonId'].coursework;
  }

  /**
   * Refresh the unit's submissions every time the cards mount (a tutor may have marked the work since the
   * learner last looked). Only the several per-assessment cards that mount together share one request; a later
   * return to the unit always refetches. Cached rows stay visible meanwhile, unless they belong to another unit.
   */
  async ensureLoaded(courseId: string, lessonId: string) {
    if (this.inflight?.lessonId === lessonId) return this.inflight.promise;
    if (this.loadedLessonId !== lessonId) {
      this.submissions = [];
      this.canSubmit = true;
    }
    const promise = this.list(courseId, lessonId).finally(() => {
      if (this.inflight?.promise === promise) this.inflight = null;
    });
    this.inflight = { lessonId, promise };
    return promise;
  }

  async list(courseId: string, lessonId: string) {
    return this.execute<(typeof classroomio.course)[':courseId']['lesson'][':lessonId']['coursework']['$get']>({
      requestFn: () => this.base(courseId, lessonId).$get({ param: { courseId, lessonId } }),
      logContext: 'listing coursework',
      onSuccess: (result) => {
        this.loadedLessonId = lessonId;
        this.submissions = result.data.submissions as CourseworkSubmission[];
        this.canSubmit = result.data.canSubmit;
      },
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
      }
    });
  }

  validateFiles(files: File[], maxBytes: number): string | null {
    if (files.length === 0) return 'Please choose at least one file.';
    for (const f of files) {
      if (!ALLOWED_TYPES.includes(f.type)) {
        return `"${f.name}" is not an accepted file type. Please upload PDF or Word (.doc, .docx).`;
      }
      if (f.size > maxBytes) {
        const mb = Math.round(maxBytes / 1024 / 1024);
        return `"${f.name}" is too large. The maximum file size is ${mb}MB.`;
      }
    }
    return null;
  }

  /**
   * PUT one file straight to storage through the shared uploader, which bounds it with an absolute timeout and a
   * no-progress watchdog (a stalled Supabase PUT used to spin forever). One retry on a stall, then a clear error.
   */
  private async putToStorage(url: string, file: File) {
    const uploader = new GenericUploader('document');
    for (let attempt = 1; ; attempt++) {
      try {
        await uploader.uploadFile({ url, file });
        return;
      } catch (error) {
        if (attempt >= 2) {
          throw new Error(
            axios.isAxiosError(error) && (error.code === 'ECONNABORTED' || axios.isCancel(error))
              ? `Uploading "${file.name}" timed out. Please check your connection and try again.`
              : error instanceof Error
                ? error.message
                : `Uploading "${file.name}" failed. Please try again.`
          );
        }
        uploader.resetAbort();
      }
    }
  }

  /**
   * Presign → PUT each file → register the submission, for ONE assessment item as a draft or final.
   * Returns true on success.
   */
  async submit(
    courseId: string,
    lessonId: string,
    assessmentKey: string,
    submissionType: 'draft' | 'final',
    files: File[],
    comment?: string
  ): Promise<boolean> {
    const itemKey = this.itemKey(lessonId, assessmentKey);
    this.uploading[itemKey] = true;
    delete this.uploadErrors[itemKey];
    const fail = (message: string) => {
      this.uploadErrors[itemKey] = message;
      snackbar.error(message);
      return false;
    };

    try {
      // 1. Presigned upload URLs (server validates type/size, computes version + keys).
      const presignRes = await this.base(courseId, lessonId).presign.$post({
        param: { courseId, lessonId },
        json: {
          assessmentKey,
          submissionType,
          files: files.map((f) => ({ fileName: f.name, fileType: f.type, fileSize: f.size }))
        }
      });
      const presign = (await presignRes.json()) as
        | {
            success: true;
            data: { version: number; files: { fileName: string; fileKey: string; uploadUrl: string }[] };
          }
        | { success: false; error?: string };
      if (!presign.success) {
        return fail(presign.error ?? 'Could not prepare the upload.');
      }

      // 2. PUT each file straight to storage.
      const { version, files: presignedFiles } = presign.data;
      for (let i = 0; i < files.length; i++) {
        const target = presignedFiles[i];
        await this.putToStorage(target.uploadUrl, files[i]);
      }

      // 3. Register the versioned submission.
      const createRes = await this.base(courseId, lessonId).$post({
        param: { courseId, lessonId },
        json: {
          assessmentKey,
          submissionType,
          version,
          files: files.map((f, i) => ({
            key: presignedFiles[i].fileKey,
            name: f.name,
            size: f.size,
            type: f.type
          })),
          ...(comment && comment.trim() ? { comment: comment.trim() } : {})
        }
      });
      const created = (await createRes.json()) as
        | { success: true; data: CourseworkSubmission }
        | { success: false; error?: string };
      if (!created.success) {
        return fail(created.error ?? 'Could not record the submission.');
      }

      this.lastSubmitted = created.data;
      snackbar.success(`${submissionType === 'draft' ? 'Draft' : 'Work'} submitted (version ${created.data.version}).`);
      await this.list(courseId, lessonId);
      return true;
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Upload failed. Please try again.');
    } finally {
      this.uploading[itemKey] = false;
    }
  }

  /** Get a short-lived signed URL for one coursework file and open it (the only door to the bytes). */
  async openFile(courseId: string, lessonId: string, key: string): Promise<void> {
    try {
      const res = await this.base(courseId, lessonId).download.$post({
        param: { courseId, lessonId },
        json: { keys: [key] }
      });
      const body = (await res.json()) as
        | { success: true; urls: Record<string, string> }
        | { success: false; error?: string };
      if (!body.success) {
        snackbar.error(body.error ?? 'Could not open the file.');
        return;
      }
      const url = body.urls[key];
      if (url) window.open(url, '_blank', 'noopener');
    } catch {
      snackbar.error('Could not open the file.');
    }
  }
}

export const courseworkApi = new CourseworkApi();
