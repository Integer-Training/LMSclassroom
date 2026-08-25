import 'dotenv/config';

import {
  generateDocumentUploadPresignedUrl,
  generateDocumentDownloadPresignedUrls,
  deleteFromS3
} from '@cio/core/utils/s3';
import { generateMaterialFileKey } from '@cio/core/utils/upload';
import { getStorageConfig } from '@cio/core/config/storage';

/**
 * E2E storage round-trip check for course-material uploads (the path Phase-10 SW-5/6/7 hardened).
 * Proves: presign material upload → PUT to Supabase Storage → presign download → GET back → bytes match.
 * Uses the demo course id for the `materials/{courseId}/…` key; cleans up the object at the end.
 *
 *   cd apps/api && npx tsx scripts/e2e-upload-check.ts
 */

const COURSE_ID = process.env.E2E_COURSE_ID ?? 'fe8aa888-81de-4703-a995-d12be184ab91'; // demo course
const content = Buffer.from(`PearlLMS E2E upload check @ ${new Date().toISOString()} — round-trip marker`);
const fileName = 'e2e-upload-check.pdf';

async function main() {
  const key = generateMaterialFileKey(COURSE_ID, fileName);
  console.log(`1. material key: ${key}`);

  const uploadUrl = await generateDocumentUploadPresignedUrl(key, 'application/pdf');
  console.log(`2. presigned UPLOAD url: ${uploadUrl.slice(0, 80)}…`);

  const put = await fetch(uploadUrl, {
    method: 'PUT',
    body: content,
    headers: { 'Content-Type': 'application/pdf' }
  });
  if (!put.ok) throw new Error(`UPLOAD failed: HTTP ${put.status} ${await put.text()}`);
  console.log(`3. PUT to Supabase Storage: HTTP ${put.status} ✓`);

  const dl = await generateDocumentDownloadPresignedUrls([key]);
  const downloadUrl = dl[key];
  if (!downloadUrl) throw new Error('no download url returned');
  console.log(`4. presigned DOWNLOAD url: ${downloadUrl.slice(0, 80)}…`);

  const get = await fetch(downloadUrl);
  if (!get.ok) throw new Error(`DOWNLOAD failed: HTTP ${get.status}`);
  const got = Buffer.from(await get.arrayBuffer());
  const match = got.equals(content);
  console.log(`5. GET back: HTTP ${get.status}, bytes match: ${match ? '✓' : '✗ MISMATCH'}`);
  if (!match) throw new Error('round-trip content mismatch');

  const { bucketDocuments } = getStorageConfig();
  const del = await deleteFromS3({ Bucket: bucketDocuments, Key: key });
  console.log(`6. cleanup delete: ${del.success ? '✓' : `✗ ${del.error}`}`);

  console.log('\n✅ STORAGE ROUND-TRIP OK — course-material upload/download is wired correctly.');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n❌ E2E upload check FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
