import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';
import { getFromS3 } from './s3';
import { getStorageConfig } from '../config/storage';

// PearlLMS — stream a set of DOCUMENTS-bucket objects as ONE zip (server-side). Used by "Download all
// submissions". Each entry maps a storage key to a path inside the zip.
//
// Scalability Phase I: the archive is never assembled in memory. Chunks are produced on demand (the response
// body pulls them, so a slow client slows the producer down) and at most `prefetch` files are in flight, so peak
// memory is a handful of files, not the whole archive. An object that cannot be read is skipped and listed in a
// MANIFEST.txt at the end of the zip — it never fails the whole download. The caller does its pre-checks (empty,
// too many files, too big) BEFORE it sends headers; once streaming has begun only the manifest can report problems.

export interface ZipEntry {
  /** Path inside the archive (already sanitised and de-duplicated by the caller). */
  path: string;
  /** Object key in the documents bucket. */
  key: string;
  /** Declared size in bytes when known (advisory — drives the in-flight memory budget only). */
  size?: number;
}

export interface ZipStreamOptions {
  /** Files fetched ahead of the one being written. Default 4. */
  prefetch?: number;
  /** Stop adding files once this many bytes are in the archive (the rest go to MANIFEST.txt). Default 250 MB. */
  maxTotalBytes?: number;
  /** Don't start another prefetch when the in-flight DECLARED sizes would pass this. Default 64 MB. */
  prefetchBudgetBytes?: number;
}

export const ZIP_MAX_FILES = 200;
export const ZIP_MAX_TOTAL_BYTES = 250 * 1024 * 1024;
export const ZIP_MANIFEST_NAME = 'MANIFEST.txt';

const DEFAULT_PREFETCH = 4;
const DEFAULT_PREFETCH_BUDGET_BYTES = 64 * 1024 * 1024;

/** Already-compressed formats are STOREd (no CPU spent re-deflating them); everything else is deflated. */
const STORE_EXTENSIONS = new Set(['pdf', 'docx', 'doc']);

export function shouldStoreUncompressed(path: string): boolean {
  const dot = path.lastIndexOf('.');
  return dot !== -1 && STORE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

interface Fetched {
  entry: ZipEntry;
  bytes?: Uint8Array;
}

/** Read one object fully (with a single retry — a transient reset must not drop a learner's file). */
async function fetchEntry(bucket: string, entry: ZipEntry): Promise<Fetched> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await getFromS3({ Bucket: bucket, Key: entry.key });
    if (!res.success || !res.data?.Body) continue;
    try {
      return { entry, bytes: await res.data.Body.transformToByteArray() };
    } catch {
      // body stream died mid-read — retry once
    }
  }
  return { entry };
}

async function* zipChunks(entries: ZipEntry[], options: ZipStreamOptions): AsyncGenerator<Uint8Array> {
  const prefetch = Math.max(1, options.prefetch ?? DEFAULT_PREFETCH);
  const maxTotalBytes = options.maxTotalBytes ?? ZIP_MAX_TOTAL_BYTES;
  const budget = options.prefetchBudgetBytes ?? DEFAULT_PREFETCH_BUDGET_BYTES;
  const bucket = getStorageConfig().bucketDocuments;

  const out: Uint8Array[] = [];
  const state: { error: Error | null } = { error: null };
  const zip = new Zip((err, chunk) => {
    if (err) state.error = err;
    else out.push(chunk);
  });
  function* drain() {
    if (state.error) throw state.error;
    while (out.length) yield out.shift()!;
  }

  const failures: { path: string; reason: string }[] = [];
  const inFlight: { promise: Promise<Fetched>; declared: number }[] = [];
  let inFlightBytes = 0;
  let next = 0;
  const topUp = () => {
    while (next < entries.length && inFlight.length < prefetch) {
      const entry = entries[next];
      const declared = entry.size ?? 0;
      if (inFlight.length > 0 && inFlightBytes + declared > budget) break;
      inFlight.push({ promise: fetchEntry(bucket, entry), declared });
      inFlightBytes += declared;
      next++;
    }
  };

  let totalBytes = 0;
  topUp();
  while (inFlight.length) {
    // The head stays counted as in flight while it is awaited, so "prefetch" is a true ceiling on concurrent reads.
    const { entry, bytes } = await inFlight[0].promise;
    inFlightBytes -= inFlight.shift()!.declared;
    topUp();

    if (!bytes) {
      failures.push({ path: entry.path, reason: 'could not be read from storage' });
    } else if (totalBytes + bytes.length > maxTotalBytes) {
      failures.push({ path: entry.path, reason: 'skipped - archive size limit reached' });
    } else {
      const file = shouldStoreUncompressed(entry.path)
        ? new ZipPassThrough(entry.path)
        : new ZipDeflate(entry.path, { level: 6 });
      zip.add(file);
      file.push(bytes, true);
      totalBytes += bytes.length;
    }
    yield* drain();
  }

  if (failures.length > 0) {
    console.warn(`[zip] ${failures.length} of ${entries.length} file(s) were not included`);
    const manifest = [
      'Some files could not be included in this archive:',
      '',
      ...failures.map((f) => `- ${f.path}: ${f.reason}`),
      ''
    ].join('\r\n');
    const file = new ZipDeflate(ZIP_MANIFEST_NAME, { level: 6 });
    zip.add(file);
    file.push(strToU8(manifest), true);
  }
  zip.end();
  yield* drain();
}

/**
 * Lazily build the zip as a web ReadableStream (pull-based, so backpressure from the HTTP client reaches the
 * producer; cancelling the stream stops fetching more files).
 */
export function createDocumentZipStream(
  entries: ZipEntry[],
  options: ZipStreamOptions = {}
): ReadableStream<Uint8Array> {
  const iterator = zipChunks(entries, options);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const step = await iterator.next();
        if (step.done) controller.close();
        else controller.enqueue(step.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    }
  });
}
