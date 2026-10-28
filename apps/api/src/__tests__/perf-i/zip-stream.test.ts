import { inflateRawSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase I (zip-buffers-whole-archive) — the download-all archive is STREAMED: chunks are produced on demand, at most
// `prefetch` objects are in flight, already-compressed formats are STOREd, an unreadable object lands in MANIFEST.txt
// instead of failing the download. The zip is parsed back with a minimal central-directory reader (no zip lib needed).

vi.mock('@cio/core/utils/s3', () => ({ getFromS3: vi.fn() }));
vi.mock('@cio/core/config/storage', () => ({ getStorageConfig: () => ({ bucketDocuments: 'documents' }) }));

import { getFromS3 } from '@cio/core/utils/s3';
import {
  createDocumentZipStream,
  shouldStoreUncompressed,
  ZIP_MANIFEST_NAME,
  type ZipEntry
} from '@cio/core/utils/zip';

const mGet = vi.mocked(getFromS3);

interface ParsedEntry {
  name: string;
  method: number;
  data: Buffer;
}

function parseZip(buf: Buffer): ParsedEntry[] {
  // End-of-central-directory record: scan back for its signature.
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ParsedEntry[] = [];
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    // local header: 30 bytes + its own name/extra lengths, then the data
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    out.push({ name, method, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

const body = (text: string) => ({
  success: true,
  data: { Body: { transformToByteArray: async () => new Uint8Array(Buffer.from(text)) } }
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('shouldStoreUncompressed', () => {
  it('stores pdf/docx/doc, deflates everything else', () => {
    expect(shouldStoreUncompressed('a/b.PDF')).toBe(true);
    expect(shouldStoreUncompressed('a/b.docx')).toBe(true);
    expect(shouldStoreUncompressed('a/b.doc')).toBe(true);
    expect(shouldStoreUncompressed('a/b.txt')).toBe(false);
    expect(shouldStoreUncompressed('a/noext')).toBe(false);
  });
});

describe('createDocumentZipStream', () => {
  it('is lazy: nothing is fetched until the stream is read', async () => {
    mGet.mockResolvedValue(body('x') as never);
    const stream = createDocumentZipStream([{ path: 'A/a.pdf', key: 'k1' }]);
    expect(mGet).not.toHaveBeenCalled();
    await collect(stream);
    expect(mGet).toHaveBeenCalledTimes(1);
  });

  it('produces a valid zip: STORE for pdf, DEFLATE for other types, content round-trips', async () => {
    mGet.mockImplementation((async ({ Key }: { Key: string }) => body(`content of ${Key}`)) as never);
    const zip = parseZip(
      await collect(
        createDocumentZipStream([
          { path: 'Alice/report.pdf', key: 'k1' },
          { path: 'Alice/notes.txt', key: 'k2' }
        ])
      )
    );
    const byName = Object.fromEntries(zip.map((e) => [e.name, e]));
    expect(Object.keys(byName).sort()).toEqual(['Alice/notes.txt', 'Alice/report.pdf']);
    expect(byName['Alice/report.pdf'].method).toBe(0);
    expect(byName['Alice/notes.txt'].method).toBe(8);
    expect(byName['Alice/report.pdf'].data.toString()).toBe('content of k1');
    expect(byName['Alice/notes.txt'].data.toString()).toBe('content of k2');
    expect(mGet).toHaveBeenCalledWith({ Bucket: 'documents', Key: 'k1' });
  });

  it('an unreadable object never fails the archive: it is listed in MANIFEST.txt', async () => {
    mGet.mockImplementation((async ({ Key }: { Key: string }) =>
      Key === 'bad' ? { success: false, error: 'NoSuchKey' } : body(`ok ${Key}`)) as never);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const zip = parseZip(
      await collect(
        createDocumentZipStream([
          { path: 'A/good.pdf', key: 'good' },
          { path: 'B/missing.pdf', key: 'bad' }
        ])
      )
    );
    expect(zip.map((e) => e.name).sort()).toEqual(['A/good.pdf', ZIP_MANIFEST_NAME].sort());
    const manifest = zip.find((e) => e.name === ZIP_MANIFEST_NAME)!.data.toString();
    expect(manifest).toContain('B/missing.pdf');
    expect(manifest).not.toContain('A/good.pdf');
    expect(manifest).not.toContain('NoSuchKey'); // storage error text is never leaked into the archive
    // one retry for the failing object, one fetch for the good one
    expect(mGet.mock.calls.filter(([a]) => (a as { Key: string }).Key === 'bad')).toHaveLength(2);
  });

  it('no manifest when everything is readable', async () => {
    mGet.mockResolvedValue(body('x') as never);
    const zip = parseZip(await collect(createDocumentZipStream([{ path: 'A/a.pdf', key: 'k' }])));
    expect(zip.map((e) => e.name)).toEqual(['A/a.pdf']);
  });

  it('files past the total-size ceiling are skipped into the manifest, not truncated', async () => {
    mGet.mockImplementation((async () => body('0123456789')) as never);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const zip = parseZip(
      await collect(
        createDocumentZipStream(
          [
            { path: 'A/one.pdf', key: 'k1' },
            { path: 'A/two.pdf', key: 'k2' }
          ],
          { maxTotalBytes: 15 }
        )
      )
    );
    expect(zip.map((e) => e.name).sort()).toEqual(['A/one.pdf', ZIP_MANIFEST_NAME].sort());
    expect(zip.find((e) => e.name === ZIP_MANIFEST_NAME)!.data.toString()).toContain('A/two.pdf');
  });

  it('keeps at most "prefetch" objects in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    mGet.mockImplementation((async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return body('x');
    }) as never);
    const entries: ZipEntry[] = Array.from({ length: 12 }, (_, i) => ({ path: `A/f${i}.pdf`, key: `k${i}` }));
    const zip = parseZip(await collect(createDocumentZipStream(entries, { prefetch: 4 })));
    expect(zip).toHaveLength(12);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // really prefetching, not serial
  });

  it('declared sizes bound the in-flight memory budget', async () => {
    let inFlight = 0;
    let peak = 0;
    mGet.mockImplementation((async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return body('x');
    }) as never);
    const entries: ZipEntry[] = Array.from({ length: 6 }, (_, i) => ({
      path: `A/f${i}.pdf`,
      key: `k${i}`,
      size: 40 * 1024 * 1024
    }));
    await collect(createDocumentZipStream(entries, { prefetch: 4, prefetchBudgetBytes: 64 * 1024 * 1024 }));
    expect(peak).toBe(1); // 40 MB files never overlap under a 64 MB budget
  });

  it('cancelling the stream stops fetching further objects', async () => {
    mGet.mockImplementation((async () => body('x')) as never);
    const entries: ZipEntry[] = Array.from({ length: 50 }, (_, i) => ({ path: `A/f${i}.pdf`, key: `k${i}` }));
    const stream = createDocumentZipStream(entries, { prefetch: 2 });
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(mGet.mock.calls.length).toBeLessThan(10);
  });
});
