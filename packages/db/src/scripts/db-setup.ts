import 'dotenv/config';

import { spawn } from 'node:child_process';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

import { baselineMigrationsIfNeeded } from './baseline';
import { getDirectConnectionString, getPostgresSsl } from './db-connection';

// Roles, advisory locks and drizzle-kit migrate must run over the DIRECT (5432)
// connection — Supabase's transaction pooler (6543) doesn't support them.
const connectionString = getDirectConnectionString();
const ssl = getPostgresSsl();
const shouldSeed = process.argv.includes('--seed') || process.argv.includes('-s');
const shouldSyncSchema = !process.argv.includes('--skip-schema-sync');
const scriptPath = fileURLToPath(import.meta.url);
const packageRoot = resolve(dirname(scriptPath), '../..');
const pnpmBinary = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const migrationsFolder = resolve(packageRoot, 'src/migrations');

// Migrator session guards: a migration blocked behind a long-held lock fails fast (instead of queueing every
// reader behind its ACCESS EXCLUSIVE request and crash-looping the API) and a runaway statement is cut off.
// Both are session-level on the migrator connection only — never ALTER ROLE (that would hit the whole app).
// Override per run for a one-off heavy migration, e.g. MIGRATION_STATEMENT_TIMEOUT=10min.
const MIGRATION_LOCK_TIMEOUT = process.env.MIGRATION_LOCK_TIMEOUT ?? '5s';
const MIGRATION_STATEMENT_TIMEOUT = process.env.MIGRATION_STATEMENT_TIMEOUT ?? '60s';

if (!connectionString) {
  console.error('DIRECT_DATABASE_URL (or DATABASE_URL/PRIVATE_DATABASE_URL) environment variable is required');
  process.exit(1);
}

async function runPnpmCommand(commandLabel: string, args: string[]) {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(pnpmBinary, args, {
      cwd: packageRoot,
      env: process.env,
      stdio: 'inherit',
      // On Windows, spawning the pnpm.cmd shim requires a shell since Node's
      // CVE-2024-27980 fix (spawning .cmd/.bat without shell throws EINVAL).
      shell: process.platform === 'win32'
    });

    child.on('error', (error) => {
      rejectPromise(error);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`${commandLabel} command failed with exit code ${code ?? 'unknown'}`));
    });
  });
}

async function runMigrations() {
  console.log(
    `Applying database migrations (lock_timeout=${MIGRATION_LOCK_TIMEOUT}, statement_timeout=${MIGRATION_STATEMENT_TIMEOUT})...`
  );
  // Same journal + __drizzle_migrations table as `drizzle-kit migrate`, run in-process so the session settings below hit the
  // very connection that executes the DDL (a startup parameter is not reliably forwarded by the session pooler).
  // onnotice: drop NOTICEs (e.g. identifier truncation) like drizzle-kit did.
  const migrator = postgres(connectionString, { max: 1, ssl, onnotice: () => {} });
  try {
    await migrator`SELECT set_config('lock_timeout', ${MIGRATION_LOCK_TIMEOUT}, false)`;
    await migrator`SELECT set_config('statement_timeout', ${MIGRATION_STATEMENT_TIMEOUT}, false)`;
    await migrate(drizzle(migrator), { migrationsFolder });
  } finally {
    await migrator.end();
  }
}

async function runSeedEssential() {
  console.log('Seeding essential reference data (roles, submissions, question-types)...');
  await runPnpmCommand('Essential seed', ['seed', '--roles', '--submissions', '--question-types']);
}

async function runSeed() {
  console.log('Seeding database...');
  await runPnpmCommand('Seed', ['seed']);
}

async function dbSetup() {
  const sql = postgres(connectionString, { ssl });

  try {
    console.log('Setting up database roles...');
    // Create authenticated role if it doesn't exist (used in RLS policies)
    const authenticatedRoleExists = await sql`
      SELECT 1 FROM pg_roles WHERE rolname = 'authenticated'
    `;
    if (authenticatedRoleExists.length === 0) {
      await sql`CREATE ROLE authenticated`;
      console.log('✓ authenticated role created');
    } else {
      console.log('✓ authenticated role already exists');
    }

    // Create anon role if it doesn't exist (used in RLS policies)
    const anonRoleExists = await sql`
      SELECT 1 FROM pg_roles WHERE rolname = 'anon'
    `;
    if (anonRoleExists.length === 0) {
      await sql`CREATE ROLE anon`;
      console.log('✓ anon role created');
    } else {
      console.log('✓ anon role already exists');
    }

    // Note: 'public' role exists by default in PostgreSQL

    if (shouldSyncSchema) {
      // Advisory lock so concurrent startups can't both pass the baseline check and double-insert.
      // Session-scoped, so held on a dedicated connection across baseline+migrate.
      const DB_SETUP_LOCK_KEY = 4242424242;
      const lock = postgres(connectionString, { max: 1, ssl });
      await lock`SELECT pg_advisory_lock(${DB_SETUP_LOCK_KEY}::bigint)`;
      try {
        await baselineMigrationsIfNeeded(sql);
        await runMigrations();
      } finally {
        await lock`SELECT pg_advisory_unlock(${DB_SETUP_LOCK_KEY}::bigint)`;
        await lock.end();
      }
    }

    await runSeedEssential();

    if (shouldSeed) {
      await runSeed();
    }
  } catch (error) {
    console.error('Failed to setup database:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

dbSetup();
