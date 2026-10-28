import { describe, expect, it, vi } from 'vitest';

// Phase I (s3-client-no-timeouts) — the operations S3 client has a connect timeout, a socket-IDLE timeout (not a total
// deadline), keep-alive agents and a bounded retry count, so a stalled object-storage socket can no longer hang a
// request forever. The presign client makes no network calls and is unchanged.

vi.mock('@cio/core/config/env', () => ({
  env: {
    OBJECT_STORAGE_ENDPOINT: 'https://storage.test',
    OBJECT_STORAGE_ACCESS_KEY_ID: 'id',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret'
  }
}));

import { getS3Client, s3RequestHandlerOptions } from '@cio/core/config/storage';

describe('s3RequestHandlerOptions', () => {
  it('bounds connect + idle time and keeps sockets alive for both https and http endpoints', () => {
    const o = s3RequestHandlerOptions();
    expect(o.connectionTimeout).toBe(5000);
    expect(o.requestTimeout).toBe(60_000);
    expect((o.httpsAgent as { keepAlive?: boolean; maxSockets?: number }).keepAlive).toBe(true);
    expect((o.httpsAgent as { maxSockets?: number }).maxSockets).toBe(200);
    expect((o.httpAgent as { keepAlive?: boolean }).keepAlive).toBe(true);
  });

  it('a longer idle timeout can be requested (jobs)', () => {
    expect(s3RequestHandlerOptions(300_000).requestTimeout).toBe(300_000);
  });
});

describe('getS3Client', () => {
  it('caps retries at 3 attempts', async () => {
    const client = getS3Client();
    expect(await client.config.maxAttempts()).toBe(3);
  });

  it('uses a node request handler that carries the configured timeouts', async () => {
    const client = getS3Client();
    const handler = client.config.requestHandler as {
      configProvider?: Promise<{ connectionTimeout?: number; requestTimeout?: number }>;
    };
    const cfg = await handler.configProvider;
    expect(cfg?.connectionTimeout).toBe(5000);
    expect(cfg?.requestTimeout).toBe(60_000);
  });
});
