import { execFile, type ChildProcess } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';

import { updateMediaJob } from '@cio/db/queries';

import { isMediaJobCancelRequested, JobCanceledError } from './cancel';
import { log } from './logger';
import { currentMediaJobId } from './media-context';

const execFileAsync = promisify(execFile);

/**
 * Resolved at module load. Set `FFMPEG_PATH` / `FFPROBE_PATH` to point at
 * non-default binary locations (e.g. when ffmpeg lives outside PATH for the
 * worker process). When unset we fall through to `ffmpeg` / `ffprobe` on
 * PATH, which is what most installs provide.
 */
export const FFMPEG_BIN = process.env.FFMPEG_PATH ?? 'ffmpeg';
export const FFPROBE_BIN = process.env.FFPROBE_PATH ?? 'ffprobe';

/** Cap subprocess stdout/stderr so a runaway log can't blow up the worker. */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

const MINUTE_MS = 60_000;
const GIB = 1024 * 1024 * 1024;
/** ffprobe / luma probes are quick; anything past this is a hung process. */
const PROBE_TIMEOUT_MS = 2 * MINUTE_MS;
/** How often a running ffmpeg checks for a cancel request / touches its media_job row. */
const WATCH_INTERVAL_MS = 10_000;
const HEARTBEAT_EVERY_TICKS = 6;

/**
 * Hard ceiling for one ffmpeg run: 30 min, plus 10 min per GiB of input, capped at 60 min. A hung process would
 * otherwise hold a worker concurrency slot forever. `FFMPEG_TIMEOUT_MS` overrides it.
 */
export function ffmpegTimeoutMs(inputBytes?: number): number {
  const override = Number(process.env.FFMPEG_TIMEOUT_MS);
  if (Number.isFinite(override) && override > 0) return override;

  const scaled = 30 * MINUTE_MS + ((inputBytes ?? 0) / GIB) * 10 * MINUTE_MS;
  return Math.min(60 * MINUTE_MS, Math.max(30 * MINUTE_MS, scaled));
}

/** Every live ffmpeg/ffprobe child, so a shutdown that outlives its grace period can kill them instead of orphaning. */
const activeChildren = new Set<ChildProcess>();

export function killActiveFfmpegProcesses(): number {
  const count = activeChildren.size;
  for (const child of activeChildren) {
    child.kill('SIGKILL');
  }
  activeChildren.clear();

  return count;
}

interface RunOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

function runBinary(bin: string, args: string[], options: RunOptions) {
  const promise = execFileAsync(bin, args, {
    maxBuffer: MAX_OUTPUT_BYTES,
    timeout: options.timeoutMs,
    killSignal: 'SIGKILL',
    signal: options.signal
  });
  const child = promise.child;
  activeChildren.add(child);
  const release = () => activeChildren.delete(child);
  promise.then(release, release);

  return promise;
}

/** The first `-i <path>` input's size, to scale the timeout. Best effort. */
async function inputSizeBytes(args: string[]): Promise<number | undefined> {
  const index = args.indexOf('-i');
  const input = index >= 0 ? args[index + 1] : undefined;
  if (!input) return undefined;

  try {
    return (await stat(input)).size;
  } catch {
    return undefined;
  }
}

/**
 * Limit ffmpeg to one thread (decoder before `-i`, encoder before the output) so a transcode cannot starve the API
 * and dashboard sharing the same 2 vCPU droplet.
 */
export function withSingleThread(args: string[]): string[] {
  const inputAt = args.indexOf('-i');
  if (inputAt < 0 || args.length < 2) return args;

  return [
    ...args.slice(0, inputAt),
    '-threads',
    '1',
    ...args.slice(inputAt, -1),
    '-threads',
    '1',
    args[args.length - 1]
  ];
}

/**
 * While a media job's ffmpeg runs: abort it on a cancel request and touch `media_job.updatedAt` so the stuck-job
 * reaper sees progress. A no-op outside a media job. Returns a stop function.
 */
function watchMediaJob(controller: AbortController): { stop: () => void; canceled: () => boolean } {
  const mediaJobId = currentMediaJobId();
  let canceled = false;
  if (!mediaJobId) return { stop: () => {}, canceled: () => false };

  let ticks = 0;
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      try {
        if (await isMediaJobCancelRequested(mediaJobId)) {
          canceled = true;
          controller.abort();
          return;
        }

        ticks += 1;
        if (ticks % HEARTBEAT_EVERY_TICKS === 0) {
          await updateMediaJob(mediaJobId, {});
        }
      } catch (error) {
        log.warn('ffmpeg-watch-failed', { mediaJobId, error: error instanceof Error ? error.message : String(error) });
      } finally {
        busy = false;
      }
    })();
  }, WATCH_INTERVAL_MS);
  timer.unref();

  return { stop: () => clearInterval(timer), canceled: () => canceled };
}

export interface FfprobeStream {
  codec_type?: 'video' | 'audio' | 'subtitle' | 'data';
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
}

export interface FfprobeFormat {
  duration?: string;
  size?: string;
  bit_rate?: string;
}

export interface FfprobeData {
  streams: FfprobeStream[];
  format: FfprobeFormat;
}

/**
 * Run `ffprobe -print_format json -show_format -show_streams <file>` and
 * return the parsed JSON. Mirrors the shape we used to get from
 * `fluent-ffmpeg.ffprobe()` but without the deprecated wrapper.
 */
export async function ffprobeJson(localPath: string): Promise<FfprobeData> {
  const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', localPath];
  const { stdout } = await runBinary(FFPROBE_BIN, args, { timeoutMs: PROBE_TIMEOUT_MS });
  return JSON.parse(stdout) as FfprobeData;
}

/**
 * Spawn ffmpeg with the supplied argv. Captures stderr and surfaces a useful
 * tail in the error message when ffmpeg exits non-zero, since ffmpeg writes
 * progress and diagnostics to stderr by default.
 */
export async function ffmpegRun(args: string[]): Promise<void> {
  const timeoutMs = ffmpegTimeoutMs(await inputSizeBytes(args));
  const controller = new AbortController();
  const watch = watchMediaJob(controller);

  try {
    await runBinary(FFMPEG_BIN, withSingleThread(args), { timeoutMs, signal: controller.signal });
  } catch (error) {
    if (watch.canceled()) {
      const mediaJobId = currentMediaJobId();
      if (mediaJobId) throw new JobCanceledError(mediaJobId);
    }

    if ((error as { killed?: boolean })?.killed) {
      throw new Error(`ffmpeg killed after ${Math.round(timeoutMs / MINUTE_MS)} min timeout`, {
        cause: error as Error
      });
    }

    const stderr = (error as { stderr?: string | Buffer })?.stderr?.toString('utf8') ?? '';
    const tail = stderr.split('\n').filter(Boolean).slice(-5).join(' | ');
    throw new Error(`ffmpeg exited with error${tail ? `: ${tail}` : ''}`, { cause: error as Error });
  } finally {
    watch.stop();
  }
}

/**
 * Compute the mean luminance (`YAVG`) of an image or single video frame using
 * ffmpeg's `signalstats` filter. Returned on the original 0-255 scale; a fully
 * black frame is ~0, fully white ~255. Throws if ffmpeg fails or the value is
 * not present in stderr.
 */
export async function ffmpegProbeLuma(filePath: string): Promise<number> {
  const args = ['-hide_banner', '-nostats', '-i', filePath, '-vf', 'signalstats', '-f', 'null', '-'];
  let stderr = '';
  try {
    const result = await runBinary(FFMPEG_BIN, args, { timeoutMs: PROBE_TIMEOUT_MS });
    const raw = result.stderr as string | Buffer | undefined;
    stderr = typeof raw === 'string' ? raw : (raw?.toString('utf8') ?? '');
  } catch (error) {
    const raw = (error as { stderr?: string | Buffer })?.stderr;
    stderr = typeof raw === 'string' ? raw : (raw?.toString('utf8') ?? '');
    if (!stderr) {
      throw error as Error;
    }
  }

  const match = stderr.match(/YAVG:([0-9]+(?:\.[0-9]+)?)/);
  if (!match) {
    throw new Error('ffmpegProbeLuma: signalstats YAVG not found in ffmpeg output');
  }

  return Number.parseFloat(match[1]);
}

/**
 * Probe for the binaries at worker startup. Logs a warning when missing so
 * media jobs surface a clearer failure than a raw ENOENT from the first
 * spawn. Non-media workers (emails, maintenance) keep booting either way.
 */
export async function warnIfFfmpegMissing(): Promise<void> {
  const checks = await Promise.all([isExecutable(FFMPEG_BIN), isExecutable(FFPROBE_BIN)]);

  const missing: string[] = [];
  if (!checks[0]) missing.push(FFMPEG_BIN);
  if (!checks[1]) missing.push(FFPROBE_BIN);

  if (missing.length === 0) {
    log.info('ffmpeg-binaries-resolved', { ffmpeg: FFMPEG_BIN, ffprobe: FFPROBE_BIN });
    return;
  }

  log.warn('ffmpeg-binaries-missing', {
    missing,
    hint: 'Install ffmpeg (macOS: brew install ffmpeg, Debian/Ubuntu: apt install ffmpeg) or set FFMPEG_PATH / FFPROBE_PATH. Media jobs will fail until this is resolved; other workers are unaffected.'
  });
}

async function isExecutable(bin: string): Promise<boolean> {
  try {
    await execFileAsync(bin, ['-version'], { maxBuffer: MAX_OUTPUT_BYTES });
    return true;
  } catch {
    return false;
  }
}
