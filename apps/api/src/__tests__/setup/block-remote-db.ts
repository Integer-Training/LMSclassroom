// Test safety net: apps/api/.env and packages/db/.env point at the PRODUCTION database, and any test that imports a
// real query module would connect to it (this happened once during perf/scalability). This runs before every test
// file, before `dotenv/config` loads, and dotenv never overrides a variable that is already set. Any non-local
// database URL is replaced with an unreachable local one, so a test can only ever reach a database on this machine.
const UNREACHABLE_DB_URL = 'postgres://test:test@127.0.0.1:1/blocked_by_test_setup';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const DB_ENV_VARS = ['DATABASE_URL', 'PRIVATE_DATABASE_URL', 'DIRECT_DATABASE_URL', 'PGDUMP_URL'];

function isLocalUrl(value: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

for (const name of DB_ENV_VARS) {
  const value = process.env[name];
  if (!value || !isLocalUrl(value)) process.env[name] = UNREACHABLE_DB_URL;
}
