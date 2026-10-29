import 'dotenv/config';

import { describe, expect, it } from 'vitest';

// Guards the setup file src/__tests__/setup/block-remote-db.ts: even after dotenv has loaded .env (which holds the
// production URL), every database URL a test can see must point at this machine.
describe('test database safety net', () => {
  it.each(['DATABASE_URL', 'PRIVATE_DATABASE_URL', 'DIRECT_DATABASE_URL', 'PGDUMP_URL'])('%s is local only', (name) => {
    const host = new URL(process.env[name] ?? '').hostname;
    expect(['localhost', '127.0.0.1', '::1', '[::1]']).toContain(host);
  });
});
