import http from 'node:http';
import https from 'node:https';
import { S3Client } from '@aws-sdk/client-s3';

import { env } from './env';

/**
 * Worker-side S3 client. Mirrors apps/api/src/config/storage.ts so workers
 * can stream the same buckets the API uploads to. Kept self-contained so
 * apps/jobs has no runtime dependency on apps/api.
 */

const BUCKET_DEFAULTS = {
  VIDEOS: 'videos',
  DOCUMENTS: 'documents',
  MEDIA: 'media'
} as const;

export interface StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  bucketVideos: string;
  bucketDocuments: string;
  bucketMedia: string;
  mediaPublicBaseUrl: string | null;
}

function useS3CompatibleConfig(): boolean {
  return Boolean(
    env.OBJECT_STORAGE_ENDPOINT && env.OBJECT_STORAGE_ACCESS_KEY_ID && env.OBJECT_STORAGE_SECRET_ACCESS_KEY
  );
}

function isCloudflareConfigured(): boolean {
  return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ACCESS_KEY && env.CLOUDFLARE_SECRET_ACCESS_KEY);
}

let cachedConfig: StorageConfig | null = null;

export function getStorageConfig(): StorageConfig {
  if (cachedConfig) return cachedConfig;

  if (useS3CompatibleConfig()) {
    cachedConfig = {
      endpoint: env.OBJECT_STORAGE_ENDPOINT!,
      region: env.OBJECT_STORAGE_REGION || 'us-east-1',
      accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY_ID!,
      secretAccessKey: env.OBJECT_STORAGE_SECRET_ACCESS_KEY!,
      forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE === 'true' || env.OBJECT_STORAGE_FORCE_PATH_STYLE === '1',
      bucketVideos: env.OBJECT_STORAGE_BUCKET_VIDEOS || BUCKET_DEFAULTS.VIDEOS,
      bucketDocuments: env.OBJECT_STORAGE_BUCKET_DOCUMENTS || BUCKET_DEFAULTS.DOCUMENTS,
      bucketMedia: env.OBJECT_STORAGE_BUCKET_MEDIA || BUCKET_DEFAULTS.MEDIA,
      mediaPublicBaseUrl: env.OBJECT_STORAGE_MEDIA_PUBLIC_BASE_URL || null
    };
  } else if (isCloudflareConfigured()) {
    cachedConfig = {
      endpoint: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      region: 'auto',
      accessKeyId: env.CLOUDFLARE_ACCESS_KEY!,
      secretAccessKey: env.CLOUDFLARE_SECRET_ACCESS_KEY!,
      forcePathStyle: false,
      bucketVideos: BUCKET_DEFAULTS.VIDEOS,
      bucketDocuments: BUCKET_DEFAULTS.DOCUMENTS,
      bucketMedia: BUCKET_DEFAULTS.MEDIA,
      mediaPublicBaseUrl: env.CLOUDFLARE_IMAGE_BUCKET_DOMAIN || null
    };
  } else {
    throw new Error(
      'Object storage not configured. Set OBJECT_STORAGE_* (MinIO/S3) or CLOUDFLARE_* (R2) env vars on apps/jobs.'
    );
  }

  return cachedConfig;
}

// PearlLMS scalability Phase I — bounded S3 I/O (see packages/core/src/config/storage.ts). Workers stream big
// video objects, so the socket IDLE timeout (no bytes for N ms, not a total deadline) is more generous.
const S3_CONNECTION_TIMEOUT_MS = 5_000;
const S3_IDLE_TIMEOUT_MS = 300_000;
const S3_MAX_SOCKETS = 200;
const S3_MAX_ATTEMPTS = 3;

let s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (s3Client) return s3Client;

  const config = getStorageConfig();
  s3Client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    },
    forcePathStyle: config.forcePathStyle,
    requestHandler: {
      connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
      requestTimeout: S3_IDLE_TIMEOUT_MS,
      httpsAgent: new https.Agent({ keepAlive: true, maxSockets: S3_MAX_SOCKETS }),
      httpAgent: new http.Agent({ keepAlive: true, maxSockets: S3_MAX_SOCKETS })
    },
    maxAttempts: S3_MAX_ATTEMPTS
  });

  return s3Client;
}
