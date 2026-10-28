import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// Phase E (nested-pool-in-invite-tx) guard: inside a `db.transaction(async (tx) => ...)` / runInTransaction
// callback the pool client `db` must not be used directly — a nested pool query checks out a SECOND connection
// while the transaction holds the first, which deadlocks the pool under concurrency. Use `tx`.

const SERVICES = path.resolve(__dirname, '../../services');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
  });
}

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

/** Bodies of every transaction callback in `source` (brace-matched), with their starting line. */
function transactionBodies(source: string): Array<{ line: number; body: string }> {
  const out: Array<{ line: number; body: string }> = [];
  const re = /(?:db\s*\.\s*transaction|runInTransaction)\(\s*async\s*\(\s*\w*\s*\)\s*=>\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let i = re.lastIndex;
    let depth = 1;
    while (depth > 0 && i < source.length) {
      const ch = source[i++];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    out.push({ line: source.slice(0, m.index).split('\n').length, body: source.slice(re.lastIndex, i) });
  }
  return out;
}

describe('no bare `db` inside transaction callbacks (apps/api/src/services)', () => {
  it('finds the transaction callbacks it is meant to police', () => {
    expect(transactionBodies(read(path.join(SERVICES, 'course/invite.ts'))).length).toBeGreaterThan(0);
    expect(transactionBodies(read(path.join(SERVICES, 'cohort/cohort.ts'))).length).toBeGreaterThan(0);
  });

  it('uses tx, never db, within every callback', () => {
    const offenders: string[] = [];
    for (const file of walk(SERVICES)) {
      for (const { line, body } of transactionBodies(read(file))) {
        body.split('\n').forEach((text, k) => {
          const code = text.replace(/\/\/.*$/, '');
          if (/(^|[^.\w])db\b/.test(code)) {
            offenders.push(`${path.relative(SERVICES, file)}:${line + k}: ${text.trim()}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('assertStudentCapacityOrThrow inside a transaction always receives the tx client', () => {
    const offenders: string[] = [];
    for (const file of walk(SERVICES)) {
      for (const { line, body } of transactionBodies(read(file))) {
        for (const call of body.matchAll(/assertStudentCapacityOrThrow\(([^)]*)\)/g)) {
          if (!/\btx\b/.test(call[1] ?? '')) offenders.push(`${path.relative(SERVICES, file)}:${line}: ${call[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the helpers that take tx as a parameter forward it to the capacity check', () => {
    expect(read(path.join(SERVICES, 'cohort/cohort.ts'))).toMatch(
      /assertStudentCapacityOrThrow\(cohort\.organizationId, 1, tx\)/
    );
    expect(read(path.join(SERVICES, 'organization/invite.ts'))).toMatch(
      /assertStudentCapacityOrThrow\(params\.organizationId, 1, tx\)/
    );
  });
});
