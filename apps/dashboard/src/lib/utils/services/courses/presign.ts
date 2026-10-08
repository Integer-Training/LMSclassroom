import { presignApi } from '$features/course/api';
import { lessonDocUpload, lessonVideoUpload } from '$features/course/components/lesson/store';

import axios from 'axios';
import { get } from 'svelte/store';

export type UploadType = 'document' | 'video' | 'generic';

// PearlLMS — the direct-to-storage PUT is the ONLY upload step without a built-in timeout (every other call
// goes through the `classroomio` client, which already aborts after 30s). An intermittently stalled Supabase
// Storage PUT therefore used to hang the uploader forever (spinner never clears). These bounds convert a stall
// into a recoverable error so the caller can retry — and transient stalls succeed on retry.
/** Abort the PUT if no upload progress is observed for this long (mid-transfer stall). */
const UPLOAD_STALL_TIMEOUT_MS = 45_000;
/** Absolute ceiling for a single PUT, floored at 2 min and scaled for large files (~16KB/s worst case). */
function uploadAbsoluteTimeoutMs(fileSizeBytes: number): number {
  return Math.max(120_000, Math.ceil(fileSizeBytes / 16_000) * 1_000);
}

export class GenericUploader {
  public abortController: AbortController | null = null;
  private uploadType: UploadType;
  private uploadStore: typeof lessonDocUpload | typeof lessonVideoUpload;

  constructor(uploadType: UploadType) {
    this.uploadType = uploadType;
    this.uploadStore = uploadType === 'document' ? lessonDocUpload : lessonVideoUpload;
    this.abortController = new AbortController();
  }

  async getDownloadPresignedUrl(keys: string[], type = this.uploadType, courseId?: string) {
    const urls =
      type === 'document'
        ? await presignApi.getDocumentDownloadUrls(keys, courseId)
        : await presignApi.getVideoDownloadUrls(keys, courseId);

    return { success: true, urls };
  }

  async getAllDownloadPresignedUrl(videoKeys: string[], docKeys: string[]) {
    const urls = {
      videos: {},
      documents: {}
    };

    try {
      if (videoKeys.length) {
        const videoResponse = await this.getDownloadPresignedUrl(videoKeys, 'video');
        urls.videos = videoResponse?.urls || {};
      }

      if (docKeys.length) {
        const docResponse = await this.getDownloadPresignedUrl(docKeys, 'document');
        urls.documents = docResponse?.urls || {};
      }
    } catch (error) {
      console.error('Error getting download presigned url:', error);
    }

    return urls;
  }

  async getPresignedUrl(file: File, courseId?: string) {
    const result =
      this.uploadType === 'document'
        ? await presignApi.getDocumentUploadUrl(
            file?.name ?? '',
            file?.type ?? '',
            file.size > 0 ? file.size : undefined,
            courseId
          )
        : await presignApi.getVideoUploadUrl(file?.name ?? '', file?.type ?? '', file.size > 0 ? file.size : undefined);

    if (!result) {
      throw new Error('Failed to get presigned upload URL');
    }

    return {
      success: true,
      url: result.url,
      fileKey: result.fileKey,
      message: 'Pre-signed URL generated successfully'
    };
  }

  async uploadFile(params: { url: string; file: File }) {
    // Make sure this attempt starts with a live (non-aborted) controller — a prior cancel/stall/retry leaves
    // the old one aborted, which would otherwise reject this PUT instantly.
    if (!this.abortController || this.abortController.signal.aborted) {
      this.abortController = new AbortController();
    }

    let lastProgressAt = Date.now();
    // Watchdog: if the browser reports no upload progress for UPLOAD_STALL_TIMEOUT_MS, the connection has
    // stalled — abort so the caller surfaces an error / retries instead of spinning forever.
    const stallWatch = setInterval(() => {
      if (Date.now() - lastProgressAt > UPLOAD_STALL_TIMEOUT_MS) {
        this.abortController?.abort();
      }
    }, 5_000);

    try {
      await axios.put(params.url, params.file, {
        headers: {
          'Content-Type': params.file.type
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        // Absolute cap (also catches a stalled *response* after the body is sent, which fires no progress events).
        timeout: uploadAbsoluteTimeoutMs(params.file.size),
        signal: this.abortController?.signal,
        onUploadProgress: (progressEvent) => {
          lastProgressAt = Date.now();
          if (get(this.uploadStore).isCancelled) {
            this.abortController?.abort();
            return;
          }

          const progress = Math.round((progressEvent.loaded * 100) / (progressEvent.total || 1));
          this.uploadStore.update((state) => ({
            ...state,
            uploadProgress: progress
          }));
        }
      });
    } finally {
      clearInterval(stallWatch);
    }
  }

  /** Discards any aborted controller and arms a fresh one so the next attempt (e.g. a retry) can proceed. */
  resetAbort() {
    this.abortController = new AbortController();
  }

  initUpload() {
    this.uploadStore.update((state) => ({
      ...state,
      isUploading: true,
      uploadProgress: 0,
      error: null,
      isCancelled: false
    }));

    this.abortController = new AbortController();
  }

  cancelUpload() {
    this.uploadStore.update((store) => ({
      ...store,
      isCancelled: true,
      isUploading: false
    }));

    this.abortController?.abort();
    this.abortController = null;
  }
}

export class DocumentUploader extends GenericUploader {
  constructor() {
    super('document');
  }
}

export class VideoUploader extends GenericUploader {
  constructor() {
    super('video');
  }
}
