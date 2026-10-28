import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Scalability Phase F — OLD vs NEW equivalence. The batched primitive (getPassedLessonIdsForLearnerCourse) and
// every caller switched behind PROGRESS_BATCHED must give EXACTLY the answers the per-unit helper
// (hasLearnerPassedUnit) gives today, over seeded fixtures covering every edge case in the plan: legacy NULL
// assessment_key; multi-item units; Refer after Pass (latest wins); drafts that can decide a legacy unit;
// exempt and optional units; and read-your-writes inside the marking transaction.
//
// This suite needs a REAL Postgres (DISTINCT ON / jsonb semantics are the thing under test), so it only runs
// when PROGRESS_EQUIV_DATABASE_URL points at a LOCAL throwaway database, e.g.
//   PROGRESS_EQUIV_DATABASE_URL=postgres://postgres@127.0.0.1:54399/eq npx vitest run src/__tests__/perf-f
// It creates (and drops) five minimal tables of its own. Without the variable it is skipped, and the shared
// client is pinned to an unreachable URL so a skipped run can never touch a real database (apps/api/.env
// points at production).

// vi.hoisted: this must run BEFORE the query modules are imported (they open the shared client at import time).
const EQUIV_URL = vi.hoisted((): string | null => {
  const url = process.env.PROGRESS_EQUIV_DATABASE_URL?.trim() || null;
  if (url && !/^postgres(ql)?:\/\/[^@/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url)) {
    throw new Error('PROGRESS_EQUIV_DATABASE_URL must point at a local (127.0.0.1/localhost) throwaway database');
  }
  process.env.DATABASE_URL = url ?? 'postgres://nobody:nobody@127.0.0.1:1/none';
  process.env.PRIVATE_DATABASE_URL = process.env.DATABASE_URL;
  if (url) process.env.DATABASE_SSL = 'disable';
  return url;
});

import { randomUUID } from 'node:crypto';
import { db, runInTransaction, sql } from '@cio/db/drizzle';
import { getPassedLessonIdsForLearnerCourse, hasLearnerPassedUnit } from '@cio/db/queries/coursework';
import { computeLearnerCourseProgress } from '@cio/db/queries/progress';
import { isCourseComplete, recordCompletionIfComplete } from '@cio/db/queries/completion';
import { isProgressBatched } from '@cio/utils/constants';

const suite = EQUIV_URL ? describe : describe.skip;

type DocSpec = { key: string; kind?: string };
type SubSpec = {
  key: string | null;
  type?: 'final' | 'draft';
  version: number;
  /** undefined → no result row at all; otherwise the result row's {kind, result}. */
  res?: { kind: 'verdict' | 'draft'; result: string | null };
};

const course = randomUUID();
const otherCourse = randomUUID();
const L = randomUUID(); // the learner under test
const OTHER = randomUUID(); // a different learner whose passes must never count
const lessons = new Map<string, string>(); // scenario name → lesson id

async function exec(q: ReturnType<typeof sql>) {
  await db.execute(q);
}

async function mkLesson(
  name: string,
  opts: { docs?: DocSpec[]; unitType?: string | null; optional?: boolean; courseId?: string } = {}
) {
  const id = randomUUID();
  lessons.set(name, id);
  const docs = JSON.stringify((opts.docs ?? []).map((d) => ({ key: d.key, kind: d.kind ?? 'workbook', name: d.key })));
  await exec(
    sql`insert into lesson (id, course_id, title, unit_type, is_optional, "order", documents)
        values (${id}, ${opts.courseId ?? course}, ${name}, ${opts.unitType ?? 'session'}, ${opts.optional ?? false},
                ${lessons.size}, ${docs}::jsonb)`
  );
  return id;
}

async function mkSub(
  learner: string,
  name: string,
  s: SubSpec,
  opts: { courseId?: string; lessonId?: string } = {}
): Promise<string> {
  const id = randomUUID();
  const lessonId = opts.lessonId ?? lessons.get(name)!;
  await exec(
    sql`insert into coursework_submission (id, learner_id, course_id, lesson_id, assessment_key, submission_type, version)
        values (${id}, ${learner}, ${opts.courseId ?? course}, ${lessonId}, ${s.key}, ${s.type ?? 'final'}, ${s.version})`
  );
  if (s.res) {
    await exec(
      sql`insert into coursework_result (id, submission_id, kind, result) values (${randomUUID()}, ${id}, ${s.res.kind}, ${s.res.result})`
    );
  }
  return id;
}

const pass = (version: number, key: string | null = 'k1'): SubSpec => ({
  key,
  version,
  res: { kind: 'verdict', result: 'PASS' }
});
const refer = (version: number, key: string | null = 'k1'): SubSpec => ({
  key,
  version,
  res: { kind: 'verdict', result: 'REFER' }
});

async function oldPassed(learner: string, lessonIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const id of lessonIds) if (await hasLearnerPassedUnit(learner, id, db)) out.add(id);
  return out;
}

async function withFlag<T>(value: 'true' | 'false', fn: () => Promise<T>): Promise<T> {
  const prev = process.env.PROGRESS_BATCHED;
  process.env.PROGRESS_BATCHED = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.PROGRESS_BATCHED;
    else process.env.PROGRESS_BATCHED = prev;
  }
}

// The expected verdict for every scenario below, pinned independently of both implementations.
const EXPECTED = new Map<string, boolean>([
  ['t-pass', true],
  ['t-pass-then-refer', false],
  ['t-refer-then-pass', true],
  ['t-multi-all', true],
  ['t-multi-partial', false],
  ['t-multi-one-referred', false],
  ['t-draft-pass-only', false],
  ['t-final-feedback-row-only', false],
  ['t-latest-verdict-null', false],
  ['t-latest-unmarked', true],
  ['t-null-key-rows-ignored', false],
  ['t-other-key-ignored', false],
  ['t-no-submissions', false],
  ['t-plain-resources-only', true], // untagged → legacy rule over a keyless PASS
  ['t-other-learner-pass', false],
  ['t-submission-course-mismatch', true],
  ['t-shared-key-pass', true],
  ['t-shared-key-fail', false],
  ['u-pass', true],
  ['u-pass-then-refer', false],
  ['u-refer-then-pass', true],
  ['u-draft-feedback-decides-pass', true],
  ['u-draft-feedback-decides-fail', false],
  ['u-draft-null-result-latest', false],
  ['u-unmarked-latest-ignored', true],
  ['u-keyed-rows-count', true],
  ['u-no-submissions', false],
  ['u-other-learner-pass', false],
  ['exempt-induction', false],
  ['exempt-id-check', false],
  ['optional-unpassed', false],
  ['optional-passed', true]
]);

suite('PROGRESS_BATCHED — old vs new equivalence (real Postgres)', () => {
  beforeAll(async () => {
    await exec(
      sql`drop table if exists coursework_result, coursework_submission, course_completion, lesson, course_section cascade`
    );
    await exec(
      sql`create table course_section (id uuid primary key default gen_random_uuid(), "order" bigint default 0)`
    );
    await exec(sql`create table lesson (
      id uuid primary key default gen_random_uuid(), course_id uuid not null, section_id uuid, title varchar not null,
      unit_type varchar, is_optional boolean not null default false, "order" bigint, created_at timestamptz default now(),
      documents jsonb not null default '[]', videos jsonb not null default '[]')`);
    await exec(sql`create table coursework_submission (
      id uuid primary key default gen_random_uuid(), learner_id uuid not null, course_id uuid not null, lesson_id uuid not null,
      assessment_key varchar, submission_type varchar not null default 'final', version integer not null default 1,
      files jsonb not null default '[]', comment text, status varchar not null default 'submitted',
      submitted_at timestamptz not null default now(),
      unique nulls not distinct (learner_id, lesson_id, assessment_key, version))`);
    await exec(sql`create table coursework_result (
      id uuid primary key default gen_random_uuid(), submission_id uuid not null unique, kind varchar not null default 'verdict',
      result varchar, feedback text, feedback_files jsonb not null default '[]', recorded_by uuid,
      recorded_at timestamptz not null default now())`);
    await exec(sql`create table course_completion (
      id uuid primary key default gen_random_uuid(), learner_id uuid not null, course_id uuid not null,
      completed_at timestamptz not null default now(), created_at timestamptz not null default now(),
      unique (learner_id, course_id))`);

    // ── TAGGED units (≥1 assessment item) ───────────────────────────────────────────────────────
    await mkLesson('t-pass', { docs: [{ key: 'k1' }] });
    await mkSub(L, 't-pass', pass(1));
    await mkLesson('t-pass-then-refer', { docs: [{ key: 'k1' }] }); // Refer after Pass → latest wins
    await mkSub(L, 't-pass-then-refer', pass(1));
    await mkSub(L, 't-pass-then-refer', refer(2));
    await mkLesson('t-refer-then-pass', { docs: [{ key: 'k1' }] });
    await mkSub(L, 't-refer-then-pass', refer(1));
    await mkSub(L, 't-refer-then-pass', pass(2));
    await mkLesson('t-multi-all', { docs: [{ key: 'k1' }, { key: 'k2' }, { key: 'k3', kind: 'casestudy' }] });
    await mkSub(L, 't-multi-all', pass(1, 'k1'));
    await mkSub(L, 't-multi-all', pass(1, 'k2'));
    await mkSub(L, 't-multi-all', pass(3, 'k3'));
    await mkLesson('t-multi-partial', { docs: [{ key: 'k1' }, { key: 'k2' }] }); // k2 never marked
    await mkSub(L, 't-multi-partial', pass(1, 'k1'));
    await mkLesson('t-multi-one-referred', { docs: [{ key: 'k1' }, { key: 'k2' }] });
    await mkSub(L, 't-multi-one-referred', pass(1, 'k1'));
    await mkSub(L, 't-multi-one-referred', pass(1, 'k2'));
    await mkSub(L, 't-multi-one-referred', refer(2, 'k2'));
    await mkLesson('t-draft-pass-only', { docs: [{ key: 'k1' }] }); // draft never gates a tagged unit
    await mkSub(L, 't-draft-pass-only', {
      key: 'k1',
      type: 'draft',
      version: 1,
      res: { kind: 'verdict', result: 'PASS' }
    });
    await mkLesson('t-final-feedback-row-only', { docs: [{ key: 'k1' }] }); // result row isn't a verdict
    await mkSub(L, 't-final-feedback-row-only', { key: 'k1', version: 1, res: { kind: 'draft', result: 'PASS' } });
    await mkLesson('t-latest-verdict-null', { docs: [{ key: 'k1' }] }); // null latest verdict shadows an earlier Pass
    await mkSub(L, 't-latest-verdict-null', pass(1));
    await mkSub(L, 't-latest-verdict-null', { key: 'k1', version: 2, res: { kind: 'verdict', result: null } });
    await mkLesson('t-latest-unmarked', { docs: [{ key: 'k1' }] }); // a later UNMARKED final does not shadow the Pass
    await mkSub(L, 't-latest-unmarked', pass(1));
    await mkSub(L, 't-latest-unmarked', { key: 'k1', version: 2 });
    await mkLesson('t-null-key-rows-ignored', { docs: [{ key: 'k1' }] }); // legacy NULL-key PASS can't pass a tagged unit
    await mkSub(L, 't-null-key-rows-ignored', pass(1, null));
    await mkLesson('t-other-key-ignored', { docs: [{ key: 'k1' }] }); // a PASS for a key no longer on the unit
    await mkSub(L, 't-other-key-ignored', pass(1, 'removed-key'));
    await mkLesson('t-no-submissions', { docs: [{ key: 'k1' }] });
    await mkLesson('t-plain-resources-only', { docs: [{ key: 'm1', kind: 'resource' }] }); // not an assessment kind → untagged
    await mkSub(L, 't-plain-resources-only', pass(1, null));
    await mkLesson('t-other-learner-pass', { docs: [{ key: 'k1' }] });
    await mkSub(OTHER, 't-other-learner-pass', pass(1));
    await mkLesson('t-submission-course-mismatch', { docs: [{ key: 'k1' }] }); // filtered by lesson, not submission.course_id
    await mkSub(L, 't-submission-course-mismatch', pass(1), { courseId: otherCourse });
    // The same assessment key on two units must not bleed between them.
    await mkLesson('t-shared-key-pass', { docs: [{ key: 'shared' }] });
    await mkLesson('t-shared-key-fail', { docs: [{ key: 'shared' }] });
    await mkSub(L, 't-shared-key-pass', pass(1, 'shared'));
    await mkSub(L, 't-shared-key-fail', refer(1, 'shared'));

    // ── UNTAGGED (legacy) units ─────────────────────────────────────────────────────────────────
    await mkLesson('u-pass');
    await mkSub(L, 'u-pass', pass(1, null));
    await mkLesson('u-pass-then-refer');
    await mkSub(L, 'u-pass-then-refer', pass(1, null));
    await mkSub(L, 'u-pass-then-refer', refer(2, null));
    await mkLesson('u-refer-then-pass');
    await mkSub(L, 'u-refer-then-pass', refer(1, null));
    await mkSub(L, 'u-refer-then-pass', pass(2, null));
    await mkLesson('u-draft-feedback-decides-pass'); // a DRAFT submission's result row decides a legacy unit
    await mkSub(L, 'u-draft-feedback-decides-pass', refer(1, null));
    await mkSub(L, 'u-draft-feedback-decides-pass', {
      key: 'x',
      type: 'draft',
      version: 2,
      res: { kind: 'draft', result: 'PASS' }
    });
    await mkLesson('u-draft-feedback-decides-fail');
    await mkSub(L, 'u-draft-feedback-decides-fail', pass(1, null));
    await mkSub(L, 'u-draft-feedback-decides-fail', {
      key: 'x',
      type: 'draft',
      version: 2,
      res: { kind: 'draft', result: 'REFER' }
    });
    await mkLesson('u-draft-null-result-latest'); // highest version has a result row with NULL result → not passing
    await mkSub(L, 'u-draft-null-result-latest', pass(1, null));
    await mkSub(L, 'u-draft-null-result-latest', {
      key: 'x',
      type: 'draft',
      version: 2,
      res: { kind: 'draft', result: null }
    });
    await mkLesson('u-unmarked-latest-ignored'); // a later submission with NO result row is skipped
    await mkSub(L, 'u-unmarked-latest-ignored', pass(1, null));
    await mkSub(L, 'u-unmarked-latest-ignored', { key: null, version: 2 });
    await mkLesson('u-keyed-rows-count'); // keyed final verdict on an untagged unit still counts under the legacy rule
    await mkSub(L, 'u-keyed-rows-count', pass(1, 'orphan'));
    await mkLesson('u-no-submissions');
    await mkLesson('u-other-learner-pass');
    await mkSub(OTHER, 'u-other-learner-pass', pass(1, null));

    // ── EXEMPT / OPTIONAL (callers exclude these from progress; the primitive must still agree) ──
    await mkLesson('exempt-induction', { unitType: 'induction' });
    await mkLesson('exempt-id-check', { unitType: 'id-check' });
    await mkLesson('optional-unpassed', { optional: true, docs: [{ key: 'k1' }] });
    await mkLesson('optional-passed', { optional: true, docs: [{ key: 'k1' }] });
    await mkSub(L, 'optional-passed', pass(1));

    // A unit of ANOTHER course must never leak into this course's set.
    await mkLesson('other-course-pass', { courseId: otherCourse, docs: [{ key: 'k1' }] });
    await mkSub(L, 'other-course-pass', pass(1), { courseId: otherCourse });
  });

  afterAll(async () => {
    await exec(
      sql`drop table if exists coursework_result, coursework_submission, course_completion, lesson, course_section cascade`
    );
  });

  const courseLessonIds = () => [...lessons.entries()].filter(([n]) => n !== 'other-course-pass').map(([, id]) => id);

  it('the batched primitive equals hasLearnerPassedUnit for EVERY unit, scenario by scenario', async () => {
    const batched = await getPassedLessonIdsForLearnerCourse(L, course, db);
    for (const [name, id] of lessons) {
      if (name === 'other-course-pass') continue;
      const oldVal = await hasLearnerPassedUnit(L, id, db);
      // Pin the scenario to its expected value too, so a bug common to both implementations is caught.
      expect(oldVal, `old:${name}`).toBe(EXPECTED.get(name));
      expect(batched.has(id), `new:${name}`).toBe(oldVal);
    }
    expect(EXPECTED.size).toBe(lessons.size - 1);
    expect(batched.has(lessons.get('other-course-pass')!)).toBe(false); // other course never leaks
  });

  it('equals the per-unit answer when the caller supplies lessonIds (subset and full)', async () => {
    const ids = courseLessonIds();
    const oldSet = await oldPassed(L, ids);
    expect(await getPassedLessonIdsForLearnerCourse(L, course, db, ids)).toEqual(oldSet);
    const half = ids.filter((_, i) => i % 2 === 0);
    expect(await getPassedLessonIdsForLearnerCourse(L, course, db, half)).toEqual(await oldPassed(L, half));
    expect(await getPassedLessonIdsForLearnerCourse(L, course, db, [])).toEqual(new Set());
    // An id that is not a lesson at all behaves like an untagged unit with no submissions.
    expect(await getPassedLessonIdsForLearnerCourse(L, course, db, [randomUUID()])).toEqual(new Set());
  });

  it("another learner's passes are theirs alone", async () => {
    const ids = courseLessonIds();
    expect(await getPassedLessonIdsForLearnerCourse(OTHER, course, db, ids)).toEqual(await oldPassed(OTHER, ids));
    expect(await getPassedLessonIdsForLearnerCourse(randomUUID(), course, db, ids)).toEqual(new Set());
  });

  it('computeLearnerCourseProgress is identical with PROGRESS_BATCHED on and off (exempt + optional units, completion date)', async () => {
    await exec(sql`insert into course_completion (learner_id, course_id) values (${L}, ${course})`);
    for (const learner of [L, OTHER]) {
      const on = await withFlag('true', () => computeLearnerCourseProgress(learner, course, db));
      const off = await withFlag('false', () => computeLearnerCourseProgress(learner, course, db));
      expect(on).toEqual(off);
    }
    const p = await withFlag('true', () => computeLearnerCourseProgress(L, course, db));
    // Exempt (induction/id-check) and optional units are outside both numerator and denominator.
    const gating = [...EXPECTED.keys()].filter((n) => !n.startsWith('exempt-') && !n.startsWith('optional-'));
    expect(p.total).toBe(gating.length);
    expect(p.passed).toBe(gating.filter((n) => EXPECTED.get(n)).length);
    expect(p.completedAt).not.toBeNull();
    await exec(sql`delete from course_completion`);
  });

  it('isCourseComplete / recordCompletionIfComplete match on and off, and the tx sees the just-recorded Pass', async () => {
    const C2 = randomUUID();
    const a = await mkLesson('c2-a', { courseId: C2, docs: [{ key: 'k1' }] });
    const b = await mkLesson('c2-b', { courseId: C2 }); // legacy untagged
    await mkLesson('c2-induction', { courseId: C2, unitType: 'induction' });
    const LEARNER = randomUUID();

    for (const flag of ['true', 'false'] as const) {
      expect(await withFlag(flag, () => isCourseComplete(LEARNER, C2, db)), `empty/${flag}`).toBe(false);
    }

    await mkSub(LEARNER, '', pass(1), { courseId: C2, lessonId: a });
    for (const flag of ['true', 'false'] as const) {
      expect(await withFlag(flag, () => isCourseComplete(LEARNER, C2, db)), `half/${flag}`).toBe(false);
    }

    // Read-your-writes: record the completing Pass INSIDE a transaction, evaluate with `tx`, then roll back.
    for (const flag of ['true', 'false'] as const) {
      class Rollback extends Error {}
      let insideTx: boolean | undefined;
      let completionRow: unknown;
      await withFlag(flag, () =>
        runInTransaction(async (tx) => {
          const sid = randomUUID();
          await tx.execute(
            sql`insert into coursework_submission (id, learner_id, course_id, lesson_id, assessment_key, version) values (${sid}, ${LEARNER}, ${C2}, ${b}, ${null}, ${1})`
          );
          await tx.execute(
            sql`insert into coursework_result (id, submission_id, kind, result) values (${randomUUID()}, ${sid}, 'verdict', 'PASS')`
          );
          insideTx = await isCourseComplete(LEARNER, C2, tx);
          completionRow = await recordCompletionIfComplete(tx, {
            learnerId: LEARNER,
            courseId: C2,
            completedAt: new Date().toISOString()
          });
          throw new Rollback();
        }).catch((e) => {
          if (!(e instanceof Rollback)) throw e;
        })
      );
      expect(insideTx, `tx sees the Pass/${flag}`).toBe(true);
      expect(completionRow, `completion recorded in the same tx/${flag}`).toBeTruthy();
      // Rolled back → committed state is still incomplete, in both modes.
      expect(await withFlag(flag, () => isCourseComplete(LEARNER, C2, db)), `after rollback/${flag}`).toBe(false);
    }

    // Committed, the course is complete under both implementations.
    await mkSub(LEARNER, '', pass(1, null), { courseId: C2, lessonId: b });
    for (const flag of ['true', 'false'] as const) {
      expect(await withFlag(flag, () => isCourseComplete(LEARNER, C2, db)), `complete/${flag}`).toBe(true);
    }
  });

  it('fuzz: 400 random learner/unit configurations agree between old and new', async () => {
    // mulberry32 — deterministic, so a failure is reproducible.
    let seed = 0xc0ffee;
    const rnd = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;

    const FC = randomUUID();
    const units: { id: string; keys: string[] }[] = [];
    for (let i = 0; i < 12; i++) {
      const nKeys = pick([0, 0, 1, 1, 2, 3]);
      const keys = Array.from({ length: nKeys }, (_, k) => `k${k + 1}`);
      units.push({ id: await mkLesson(`fuzz-${i}`, { courseId: FC, docs: keys.map((key) => ({ key })) }), keys });
    }

    for (let n = 0; n < 40; n++) {
      const learner = randomUUID();
      for (const u of units) {
        // Legacy/untagged rows tie on version across keys, so give each (learner, unit) a strictly rising counter.
        let counter = 0;
        const keyPool: (string | null)[] = [...u.keys, null, 'stale-key'];
        const rows = Math.floor(rnd() * 5);
        const perKeyVersion = new Map<string | null, number>();
        for (let r = 0; r < rows; r++) {
          const key = pick(keyPool);
          counter++;
          const version = u.keys.length > 0 ? (perKeyVersion.get(key) ?? 0) + 1 : counter;
          perKeyVersion.set(key, version);
          const type = pick(['final', 'final', 'draft'] as const);
          const hasRes = rnd() < 0.8;
          const kind = pick(['verdict', 'verdict', 'verdict', 'draft'] as const);
          const result = pick(['PASS', 'PASS', 'REFER', null] as (string | null)[]);
          await mkSub(
            learner,
            '',
            { key, type, version, res: hasRes ? { kind, result } : undefined },
            { courseId: FC, lessonId: u.id }
          );
        }
      }
      const ids = units.map((u) => u.id);
      expect(await getPassedLessonIdsForLearnerCourse(learner, FC, db, ids), `learner #${n}`).toEqual(
        await oldPassed(learner, ids)
      );
    }
  }, 120_000);

  it('the flag defaults ON and is switched off by false/0/off/no', () => {
    expect(isProgressBatched({})).toBe(true);
    expect(isProgressBatched({ PROGRESS_BATCHED: 'true' })).toBe(true);
    expect(isProgressBatched({ PROGRESS_BATCHED: '' })).toBe(true);
    for (const v of ['false', 'FALSE', '0', 'off', 'no', ' false ']) {
      expect(isProgressBatched({ PROGRESS_BATCHED: v }), v).toBe(false);
    }
  });
});
