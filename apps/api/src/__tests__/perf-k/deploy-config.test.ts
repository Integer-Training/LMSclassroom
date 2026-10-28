import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Phase K (K3, K4) — static guards on the production compose file and Caddyfile (no docker needed): migrations run in a
// one-shot service that the api and dashboard wait for, restart windows are bridged by Caddy, resource limits exist, and the
// DB pool defaults are NOT raised (they must equal the code default of 10).

const root = path.resolve(__dirname, '../../../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const compose = read('docker-compose.deploy.yaml');

/** The text of one top-level service block (from `  name:` to the next service or the volumes section). */
function service(name: string): string {
  const match = compose.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n|\\nvolumes:)`));
  if (!match) throw new Error(`service ${name} not found`);
  return match[1];
}

describe('docker-compose.deploy.yaml', () => {
  it('runs db:setup in a one-shot migrate service that never restarts and never pulls', () => {
    const migrate = service('migrate');

    expect(migrate).toContain("restart: 'no'");
    expect(migrate).toContain('image: pearl-api:local');
    expect(migrate).toContain('pull_policy: never');
    expect(migrate).toContain("entrypoint: ['pnpm', '--filter', '@cio/db', 'db:setup']");
    expect(migrate).toContain('DIRECT_DATABASE_URL');
  });

  it('builds the api image under the tag the migrate service uses', () => {
    expect(service('api')).toContain('image: pearl-api:local');
  });

  it('makes api and dashboard wait for the migrator and skips the in-entrypoint setup on the api', () => {
    for (const name of ['api', 'dashboard']) {
      expect(service(name)).toMatch(/migrate:\n\s+condition: service_completed_successfully/);
    }
    expect(service('api')).toContain("SKIP_DB_SETUP: 'true'");
    // the migrator itself must not skip its own work
    expect(service('migrate')).not.toContain('SKIP_DB_SETUP');
  });

  it('never passes empty migration timeouts (Postgres rejects an empty lock_timeout, so the deploy would never start)', () => {
    const migrate = service('migrate');
    expect(migrate).toContain('MIGRATION_LOCK_TIMEOUT: ${MIGRATION_LOCK_TIMEOUT:-5s}');
    expect(migrate).toContain('MIGRATION_STATEMENT_TIMEOUT: ${MIGRATION_STATEMENT_TIMEOUT:-60s}');
    expect(migrate).not.toMatch(/MIGRATION_\w+: \$\{MIGRATION_\w+:-\}/);
    // and db-setup itself treats an empty value as unset (`||`, not `??`)
    const dbSetup = read('packages/db/src/scripts/db-setup.ts');
    expect(dbSetup).toMatch(/MIGRATION_LOCK_TIMEOUT\?\.trim\(\) \|\| '5s'/);
    expect(dbSetup).toMatch(/MIGRATION_STATEMENT_TIMEOUT\?\.trim\(\) \|\| '60s'/);
  });

  it('gives the dashboard a healthcheck and makes caddy wait for it', () => {
    expect(service('dashboard')).toContain('healthcheck:');
    expect(service('caddy')).toMatch(/dashboard:\n\s+condition: service_healthy/);
  });

  it('sets memory limits and a matching heap per service, and a noeviction redis', () => {
    expect(service('api')).toMatch(/mem_limit: \$\{API_MEM_LIMIT:-768m\}/);
    expect(service('api')).toContain('--max-old-space-size=576');
    expect(service('dashboard')).toMatch(/mem_limit: \$\{DASHBOARD_MEM_LIMIT:-768m\}/);
    expect(service('jobs')).toMatch(/mem_limit: \$\{JOBS_MEM_LIMIT:-1200m\}/);
    expect(service('jobs')).toMatch(/cpus: \$\{JOBS_CPUS:-1\.0\}/);
    expect(service('caddy')).toMatch(/mem_limit: \$\{CADDY_MEM_LIMIT:-128m\}/);
    const redis = service('redis');
    expect(redis).toContain("'--maxmemory-policy', 'noeviction'");
    expect(redis).toContain("'--maxmemory', '400mb'");
    expect(redis).toMatch(/mem_limit: \$\{REDIS_MEM_LIMIT:-512m\}/);
  });

  it('passes the pool sizes through with defaults equal to the code default (not raised)', () => {
    expect(service('api')).toContain('DATABASE_POOL_MAX: ${DATABASE_POOL_MAX:-10}');
    expect(service('jobs')).toContain('DATABASE_POOL_MAX: ${JOBS_DATABASE_POOL_MAX:-10}');
    expect(read('packages/db/src/drizzle.ts')).toContain("process.env.DATABASE_POOL_MAX ?? '10'");
  });

  it('leaves Sentry empty (disabled) by default', () => {
    expect(service('api')).toContain('SENTRY_DSN: ${SENTRY_DSN:-}');
    expect(service('api')).toContain('SENTRY_ENABLED: ${SENTRY_ENABLED:-}');
    expect(service('dashboard')).toContain('PUBLIC_SENTRY_ENABLED: ${PUBLIC_SENTRY_ENABLED:-}');
  });

  it('documents every new knob in .env.deploy.example', () => {
    const env = read('.env.deploy.example');
    for (const key of [
      'DATABASE_POOL_MAX',
      'JOBS_DATABASE_POOL_MAX',
      'API_MEM_LIMIT',
      'JOBS_MEM_LIMIT',
      'SENTRY_ENABLED'
    ]) {
      expect(env).toContain(key);
    }
  });
});

describe('Caddyfile', () => {
  it('retries the dashboard upstream through a restart instead of returning 502 at once', () => {
    const caddy = read('docker/Caddyfile');

    expect(caddy).toContain('lb_try_duration 30s');
    expect(caddy).toContain('lb_try_interval 250ms');
  });
});

describe('api entrypoint', () => {
  it('still honours SKIP_DB_SETUP=true by skipping db:setup', () => {
    const entrypoint = read('docker/entrypoint-api.sh');

    expect(entrypoint).toContain('if [ "${SKIP_DB_SETUP}" = "true" ]');
    expect(entrypoint).toMatch(/Skipping database setup/);
  });
});
