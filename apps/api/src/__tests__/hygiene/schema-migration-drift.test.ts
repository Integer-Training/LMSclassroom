import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Every column the Drizzle schema declares must be created by some SQL migration. Upstream once added
// course_newsfeed_comment.reply_to_comment_id to schema.ts + the snapshots with no SQL migration, so production
// never got the column and every newsfeed comment failed (fixed by 0028). Source-level guard: it reads the newest
// snapshot and the migration files, no database needed.
const migrationsDir = path.resolve(__dirname, '../../../../../packages/db/src/migrations');

type Snapshot = { tables: Record<string, { name: string; columns: Record<string, unknown> }> };

function columnsCreatedByMigrations(sql: string): Map<string, Set<string>> {
  const created = new Map<string, Set<string>>();
  const add = (table: string, column: string) => {
    if (!created.has(table)) created.set(table, new Set());
    created.get(table)!.add(column);
  };

  for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"(?:public"\.")?([a-z_]+)" \(([\s\S]*?)\n\);/g)) {
    for (const col of m[2].matchAll(/^\s*"([A-Za-z_]+)"/gm)) add(m[1], col[1]);
  }
  for (const m of sql.matchAll(
    /ALTER TABLE "(?:public"\.")?([a-z_]+)" ADD COLUMN (?:IF NOT EXISTS )?"([A-Za-z_]+)"/g
  )) {
    add(m[1], m[2]);
  }
  for (const m of sql.matchAll(
    /ALTER TABLE "(?:public"\.")?([a-z_]+)" RENAME COLUMN "[A-Za-z_]+" TO "([A-Za-z_]+)"/g
  )) {
    add(m[1], m[2]);
  }
  return created;
}

describe('schema vs migrations', () => {
  it('every schema column is created by a SQL migration', () => {
    const files = readdirSync(migrationsDir).sort();
    const sql = files
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(path.join(migrationsDir, f), 'utf8'))
      .join('\n');
    const latestSnapshot = readdirSync(path.join(migrationsDir, 'meta'))
      .filter((f) => f.endsWith('_snapshot.json'))
      .sort()
      .at(-1)!;
    const snapshot = JSON.parse(readFileSync(path.join(migrationsDir, 'meta', latestSnapshot), 'utf8')) as Snapshot;

    const created = columnsCreatedByMigrations(sql);
    const missing: string[] = [];
    for (const table of Object.values(snapshot.tables)) {
      for (const column of Object.keys(table.columns)) {
        if (!created.get(table.name)?.has(column)) missing.push(`${table.name}.${column}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
