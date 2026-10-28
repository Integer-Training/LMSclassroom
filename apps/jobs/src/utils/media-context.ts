import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Ties a running media BullMQ job to its `media_job` row without threading the id through every processor helper.
 * `ffmpegRun` reads it to (a) poll for a cancel request and kill ffmpeg mid-run and (b) touch `media_job.updatedAt`
 * while ffmpeg is alive so the stuck-job reaper does not fail a long but healthy transcode.
 */
const storage = new AsyncLocalStorage<{ mediaJobId: string }>();

export function runWithMediaJob<T>(mediaJobId: string | undefined, fn: () => T): T {
  return mediaJobId ? storage.run({ mediaJobId }, fn) : fn();
}

export function currentMediaJobId(): string | undefined {
  return storage.getStore()?.mediaJobId;
}
