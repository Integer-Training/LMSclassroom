import JSZip from 'jszip';
import { getFromS3 } from './s3';
import { getStorageConfig } from '../config/storage';

// PearlLMS — zip a set of DOCUMENTS-bucket objects into one archive (server-side). Used by "Download all
// submissions". Each entry maps a storage key to a path inside the zip. An unreadable object is skipped
// (never fails the whole archive); the caller decides what to do when nothing was added.
export async function zipDocumentObjects(
  entries: { path: string; key: string }[]
): Promise<{ buffer: Buffer; added: number }> {
  const bucket = getStorageConfig().bucketDocuments;
  const zip = new JSZip();
  let added = 0;
  for (const e of entries) {
    const res = await getFromS3({ Bucket: bucket, Key: e.key });
    if (!res.success || !res.data?.Body) continue;
    const bytes = await res.data.Body.transformToByteArray();
    zip.file(e.path, bytes);
    added++;
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { buffer, added };
}
