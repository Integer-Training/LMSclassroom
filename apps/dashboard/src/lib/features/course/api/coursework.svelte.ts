import axios from 'axios';
import { classroomio } from '$lib/utils/services/api';
import { BaseApi } from '$lib/utils/services/api/base.svelte';
import { snackbar } from '$features/ui/snackbar/store';

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
  version: number;
  files: CourseworkFile[];
  status: string;
  submittedAt: string;
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
  isUploading = $state(false);
  uploadError = $state<string | null>(null);
  lastSubmitted = $state<CourseworkSubmission | null>(null);

  private base(courseId: string, lessonId: string) {
    return classroomio.course[':courseId'].lesson[':lessonId'].coursework;
  }

  async list(courseId: string, lessonId: string) {
    return this.execute<(typeof classroomio.course)[':courseId']['lesson'][':lessonId']['coursework']['$get']>({
      requestFn: () => this.base(courseId, lessonId).$get({ param: { courseId, lessonId } }),
      logContext: 'listing coursework',
      onSuccess: (result) => {
        this.submissions = result.data as CourseworkSubmission[];
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

  /** Presign → PUT each file → register the submission. Returns true on success. */
  async submit(courseId: string, lessonId: string, files: File[]): Promise<boolean> {
    this.isUploading = true;
    this.uploadError = null;

    try {
      // 1. Presigned upload URLs (server validates type/size, computes version + keys).
      const presignRes = await this.base(courseId, lessonId).presign.$post({
        param: { courseId, lessonId },
        json: {
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
        this.uploadError = presign.error ?? 'Could not prepare the upload.';
        snackbar.error(this.uploadError);
        return false;
      }

      // 2. PUT each file straight to storage.
      const { version, files: presignedFiles } = presign.data;
      for (let i = 0; i < files.length; i++) {
        const target = presignedFiles[i];
        await axios.put(target.uploadUrl, files[i], { headers: { 'Content-Type': files[i].type } });
      }

      // 3. Register the versioned submission.
      const createRes = await this.base(courseId, lessonId).$post({
        param: { courseId, lessonId },
        json: {
          version,
          files: files.map((f, i) => ({
            key: presignedFiles[i].fileKey,
            name: f.name,
            size: f.size,
            type: f.type
          }))
        }
      });
      const created = (await createRes.json()) as
        | { success: true; data: CourseworkSubmission }
        | { success: false; error?: string };
      if (!created.success) {
        this.uploadError = created.error ?? 'Could not record the submission.';
        snackbar.error(this.uploadError);
        return false;
      }

      this.lastSubmitted = created.data;
      snackbar.success(`Coursework submitted (version ${created.data.version}).`);
      await this.list(courseId, lessonId);
      return true;
    } catch (error) {
      this.uploadError = error instanceof Error ? error.message : 'Upload failed. Please try again.';
      snackbar.error(this.uploadError);
      return false;
    } finally {
      this.isUploading = false;
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
