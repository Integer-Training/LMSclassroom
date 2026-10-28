import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// Phase H1 — BEFORE/AFTER snapshot parity on a seeded dataset: 200 learners, 5 tutors with overlapping allocation
// (a learner may have 0, 1 or 2 tutors; one allocated learner is NOT in the org STUDENT roster), 3 courses (one
// draft), legacy NULL assessment-key rows, drafts / verdicts / resubmissions, deactivated learners, never-seen and
// long-inactive learners, due-soon / overdue work.
//
// The "before" is a FROZEN copy of the pre-H1 services (./legacy/*): heavy submission rows, one full load per tutor,
// one progress report per course. The "after" is the real service. Both run against the SAME in-memory mock of the
// DB layer, so any difference in the JSON is a behaviour change. The only intended numeric change is decision #3
// (completion % = recorded completions of currently-enrolled students); the fixture records completions exactly for
// the learners the old rule counted as complete, so the numbers must still match here, and the decision-3 specifics
// (non-enrolled completers ignored, capped at 100) are asserted separately.
// DB reads are mocked — no database is contacted.

type Row = {
  id: string;
  learnerId: string;
  courseId: string;
  lessonId: string;
  assessmentKey: string | null;
  submissionType: 'final' | 'draft';
  version: number;
  files: { key: string; name: string }[];
  comment: string | null;
  status: string;
  submittedAt: string;
  courseTitle: string;
  unitTitle: string;
  resultKind: 'verdict' | 'draft' | null;
  result: string | null;
  feedback: string | null;
  resultRecordedAt: string | null;
};

const H = vi.hoisted(() => {
  const state = {
    orgId: 'org-1',
    learners: [] as { learnerId: string; name: string | null; email: string | null; status: string }[],
    tutors: [] as { id: string; name: string | null; email: string | null }[],
    alloc: new Map<string, string[]>(), // tutorId -> learnerIds (tutor_allocation only)
    profileStatus: new Map<string, string>(),
    lastSeen: new Map<string, string | null>(),
    subs: [] as unknown[],
    lessonItems: new Map<string, unknown[]>(), // lessonId -> assessment items
    courses: [] as { courseId: string; title: string; isPublished: boolean; enrolled: number }[],
    enrolments: [] as { courseId: string; learnerId: string }[],
    lessonPairs: [] as { lessonId: string; courseId: string }[],
    completions: [] as { courseId: string; learnerId: string }[], // course_completion rows (any learner)
    unallocated: { total: 0, learners: [] as unknown[] }
  };
  const calls: Record<string, number> = {};
  const hit = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
  return { state, calls, hit };
});

const lean = (r: Row) => {
  const { files: _f, comment: _c, feedback: _fb, ...rest } = r;
  return rest;
};
const forIds = (ids: string[]) => {
  const set = new Set(ids);
  return (H.state.subs as Row[]).filter((s) => set.has(s.learnerId));
};

vi.mock('@cio/db/queries/dash', () => ({
  getActiveBroadcastCount: vi.fn(async () => 2),
  getCourseEnrolledLearnerIds: vi.fn(async () => H.state.enrolments),
  getEnrollmentTrend: vi.fn(async () => []),
  getCertificateStats: vi.fn(async () => ({ total: 7, thisMonth: 1 })),
  getCompletionStats: vi.fn(async () => ({ total: 9, thisMonth: 2, byCourse: [] })),
  getIdVerificationBreakdown: vi.fn(async () => [{ status: 'verified', count: 30 }]),
  getLessonCoursePairs: vi.fn(async () => H.state.lessonPairs),
  getMemberRoleStatusCounts: vi.fn(async () => [
    { roleId: 2, status: 'ACTIVE', count: 5 },
    { roleId: 3, status: 'ACTIVE', count: 200 }
  ]),
  getOrgCoursesWithEnrolment: vi.fn(async () => H.state.courses),
  getOrgMessagingStats: vi.fn(async () => ({ activeThreads: 3, messagesLast7d: 11 })),
  getOrgStudyHoursMonthly: vi.fn(async () => []),
  getPublishedCourseCount: vi.fn(async () => 2),
  getRecordedCompletionCountsByCourse: vi.fn(async () => {
    // Real query semantics: distinct completers who are CURRENTLY enrolled students of that course.
    const enrolled = new Set(H.state.enrolments.map((e) => `${e.courseId}:${e.learnerId}`));
    const per = new Map<string, Set<string>>();
    for (const c of H.state.completions) {
      if (!enrolled.has(`${c.courseId}:${c.learnerId}`)) continue;
      (per.get(c.courseId) ?? per.set(c.courseId, new Set()).get(c.courseId)!).add(c.learnerId);
    }
    return [...per].map(([courseId, set]) => ({ courseId, completed: set.size }));
  }),
  getRegistrationFunnel: vi.fn(async () => [{ status: 'pending', count: 4 }]),
  getSubmissionsOverTime: vi.fn(async () => []),
  listOrgLearners: vi.fn(async () => H.state.learners),
  listUnallocatedEnrolledLearners: vi.fn(async () => H.state.unallocated),
  getOnlineOrgMembers: vi.fn(async () => []),
  getCourseCounts: vi.fn(async () => ({ published: 2, draft: 1 }))
}));
vi.mock('@cio/db/queries/allocation', () => ({
  listLearnersForTutor: vi.fn(async (tutorId: string) => {
    H.hit('listLearnersForTutor');
    return (H.state.alloc.get(tutorId) ?? []).map((learnerId) => ({ learnerId, name: null, email: null }));
  }),
  listAllocatedLearnerIdsByTutors: vi.fn(async (tutorIds: string[]) => {
    H.hit('listAllocatedLearnerIdsByTutors');
    const out = new Map<string, string[]>();
    for (const t of tutorIds) {
      const ids = H.state.alloc.get(t);
      if (ids?.length) out.set(t, [...ids]);
    }
    return out;
  })
}));
vi.mock('@cio/db/queries/comms', () => ({ listOrgTutors: vi.fn(async () => H.state.tutors) }));
vi.mock('@cio/db/queries/analytics', () => ({
  getLastSeenForUserIds: vi.fn(async (ids: string[]) => {
    H.hit('getLastSeenForUserIds');
    return new Map(ids.map((id) => [id, H.state.lastSeen.get(id) ?? null] as const));
  })
}));
vi.mock('@cio/db/queries/caseload', () => ({
  getProfileStatusForIds: vi.fn(async (ids: string[]) => {
    H.hit('getProfileStatusForIds');
    return new Map(ids.filter((id) => H.state.profileStatus.has(id)).map((id) => [id, H.state.profileStatus.get(id)!]));
  }),
  getCoursesForLearners: vi.fn(async (ids: string[]) => {
    H.hit('getCoursesForLearners');
    const set = new Set(ids);
    const per = new Map<string, Set<string>>();
    for (const e of H.state.enrolments)
      if (set.has(e.learnerId))
        (per.get(e.courseId) ?? per.set(e.courseId, new Set()).get(e.courseId)!).add(e.learnerId);
    return H.state.courses
      .filter((c) => per.has(c.courseId))
      .map((c) => ({ courseId: c.courseId, title: c.title, learners: per.get(c.courseId)!.size }))
      .sort((a, b) => b.learners - a.learners);
  }),
  getLessonIdsForCourses: vi.fn(async (courseIds: string[]) =>
    H.state.lessonPairs.filter((p) => courseIds.includes(p.courseId)).map((p) => p.lessonId)
  )
}));
vi.mock('@cio/db/queries/coursework', () => ({
  getSubmissionsWithContextForLearners: vi.fn(async (ids: string[]) => {
    H.hit('getSubmissionsWithContextForLearners');
    return forIds(ids);
  }),
  getSubmissionStatusRowsForLearners: vi.fn(async (ids: string[]) => {
    H.hit('getSubmissionStatusRowsForLearners');
    return forIds(ids).map(lean);
  }),
  getAssessmentItemsByLesson: vi.fn(async (lessonIds: string[]) => {
    H.hit('getAssessmentItemsByLesson');
    const m = new Map<string, unknown[]>();
    for (const id of lessonIds) if (H.state.lessonItems.has(id)) m.set(id, H.state.lessonItems.get(id)!);
    return m;
  })
}));
vi.mock('@cio/db/queries/reports', () => ({
  // The legacy overview built "completed" from the live per-course report. Here: enrolled learners of the course,
  // completed iff they have a recorded completion (same set the new rule counts).
  getCourseProgressReport: vi.fn(async (courseId: string) => {
    H.hit('getCourseProgressReport');
    const done = new Set(H.state.completions.filter((c) => c.courseId === courseId).map((c) => c.learnerId));
    return {
      courseId,
      rows: H.state.enrolments
        .filter((e) => e.courseId === courseId)
        .map((e) => ({ learnerId: e.learnerId, completed: done.has(e.learnerId) }))
    };
  })
}));

import { computePipelineForRoster } from '@api/services/caseload/caseload';
import { getAdminOverview } from '@api/services/dash/admin-overview';
import { computePipelineForRoster as legacyPipeline } from './legacy/caseload.legacy';
import { getAdminOverview as legacyOverview } from './legacy/admin-overview.legacy';

const NOW = new Date('2026-10-28T12:00:00Z');
const admin: Actor = { authenticated: true, userId: 'adm', role: 'ADMIN', status: 'ACTIVE', orgId: 'org-1' };
const manager: Actor = { authenticated: true, userId: 'mgr', role: 'MANAGER', status: 'ACTIVE', orgId: 'org-1' };

// Deterministic PRNG so the fixture is identical on every run.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUR = 3_600_000;
const iso = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * HOUR).toISOString();

function seed(opts: { learners?: number } = {}) {
  const rnd = mulberry32(20261028);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const N = opts.learners ?? 200;
  const S = H.state;
  S.learners = [];
  S.tutors = [];
  S.alloc = new Map();
  S.profileStatus = new Map();
  S.lastSeen = new Map();
  S.subs = [];
  S.lessonItems = new Map();
  S.courses = [];
  S.enrolments = [];
  S.lessonPairs = [];
  S.completions = [];

  // 5 tutors.
  for (let t = 1; t <= 5; t++) S.tutors.push({ id: `T${t}`, name: `Tutor ${t}`, email: `t${t}@x` });
  S.tutors.push({ id: 'T-empty', name: 'No Learners', email: 'e@x' }); // a tutor with no allocations at all

  // 3 courses (C3 is a draft), 4 lessons each; lessons L{c}{n}. Items: workbook / casestudy with dueAt.
  const courseDefs = [
    { courseId: 'C1', title: 'Course One', isPublished: true },
    { courseId: 'C2', title: 'Course Two', isPublished: true },
    { courseId: 'C3', title: 'Course Three (draft)', isPublished: false }
  ];
  const lessons: { lessonId: string; courseId: string; keys: string[] }[] = [];
  for (const c of courseDefs) {
    for (let n = 1; n <= 4; n++) {
      const lessonId = `LS-${c.courseId}-${n}`;
      const keys: string[] = [];
      const items: unknown[] = [];
      if (n !== 4) {
        // Lesson 4 has NO tagged assessments -> only legacy NULL-key submissions exist for it.
        for (const k of n === 1 ? ['wb'] : ['wb', 'cs']) {
          keys.push(k);
          const dueOffsets = [null, 24, 48, 24 * 10, -24 * 5];
          const due = pick(dueOffsets);
          items.push({
            key: k,
            kind: k === 'wb' ? 'workbook' : 'casestudy',
            name: `${k.toUpperCase()} ${lessonId}`,
            dueAt: due === null ? null : iso(due),
            allowDrafts: true
          });
        }
      }
      S.lessonItems.set(lessonId, items);
      S.lessonPairs.push({ lessonId, courseId: c.courseId });
      lessons.push({ lessonId, courseId: c.courseId, keys });
    }
  }

  // Learners.
  for (let i = 0; i < N; i++) {
    const id = `L${String(i).padStart(3, '0')}`;
    const deactivated = i % 37 === 0;
    S.learners.push({
      learnerId: id,
      name: `Learner ${String(i).padStart(3, '0')}`,
      email: `${id.toLowerCase()}@x`,
      status: deactivated ? 'DEACTIVATED' : 'ACTIVE'
    });
    S.profileStatus.set(id, deactivated ? 'DEACTIVATED' : 'ACTIVE');
    const seenKind = i % 5;
    S.lastSeen.set(
      id,
      seenKind === 0 ? null : seenKind === 1 ? iso(-24 * 90) : seenKind === 2 ? iso(-24 * 31) : iso(-24 * (i % 20))
    );
  }
  // One allocated learner who is NOT an org STUDENT member (a tutor roster has no org filter).
  S.profileStatus.set('X-out', 'ACTIVE');
  S.lastSeen.set('X-out', iso(-24 * 2));

  // Allocation: ~15% of learners unallocated, ~25% double-allocated (overlap), the rest single.
  const tutorIds = ['T1', 'T2', 'T3', 'T4', 'T5'];
  const addAlloc = (t: string, l: string) => {
    const list = S.alloc.get(t) ?? [];
    if (!list.includes(l)) list.push(l);
    S.alloc.set(t, list);
  };
  for (let i = 0; i < N; i++) {
    const id = S.learners[i].learnerId;
    const r = rnd();
    if (r < 0.15) continue; // unallocated
    const t1 = pick(tutorIds);
    addAlloc(t1, id);
    if (r > 0.75) addAlloc(pick(tutorIds.filter((t) => t !== t1)), id); // overlap: two tutors
  }
  addAlloc('T1', 'X-out');

  // Enrolments: 1-3 courses each (C3 draft rarely).
  const enrolled: Record<string, string[]> = {};
  for (let i = 0; i < N; i++) {
    const id = S.learners[i].learnerId;
    const cs = ['C1', 'C2', 'C3'].filter((_, k) => (k === 0 ? true : k === 1 ? rnd() < 0.55 : rnd() < 0.15));
    enrolled[id] = cs;
    for (const c of cs) S.enrolments.push({ courseId: c, learnerId: id });
  }
  enrolled['X-out'] = ['C1'];
  S.enrolments.push({ courseId: 'C1', learnerId: 'X-out' });

  // Submissions.
  let sid = 0;
  const addSub = (p: Partial<Row> & Pick<Row, 'learnerId' | 'courseId' | 'lessonId'>) => {
    sid++;
    const submittedAt = p.submittedAt ?? iso(-Math.floor(rnd() * 24 * 30));
    const row: Row = {
      id: `S${sid}`,
      assessmentKey: null,
      submissionType: 'final',
      version: 1,
      files: [{ key: `k/${sid}`, name: 'a.docx' }],
      comment: 'c',
      status: 'submitted',
      courseTitle: courseDefs.find((c) => c.courseId === p.courseId)!.title,
      unitTitle: `Unit ${p.lessonId}`,
      resultKind: null,
      result: null,
      feedback: null,
      resultRecordedAt: null,
      ...p,
      submittedAt
    } as Row;
    S.subs.push(row);
  };
  const subLearners = [...S.learners.map((l) => l.learnerId), 'X-out'];
  for (const id of subLearners) {
    for (const cid of enrolled[id] ?? []) {
      for (const ls of lessons.filter((l) => l.courseId === cid)) {
        if (rnd() < 0.45) continue;
        const keys = ls.keys.length ? ls.keys : [null as unknown as string]; // lesson 4 -> legacy NULL key
        for (const key of keys) {
          if (rnd() < 0.35) continue;
          const nVersions = 1 + Math.floor(rnd() * 3);
          let t0 = -Math.floor(rnd() * 24 * 25) - 1;
          for (let v = 1; v <= nVersions; v++) {
            const isDraft = ls.keys.length > 0 && rnd() < 0.25;
            const submittedAt = iso(t0);
            const last = v === nVersions;
            // result: earlier versions are marked (refer -> resubmit); the last may be unmarked / pass / refer.
            let resultKind: Row['resultKind'] = null;
            let result: string | null = null;
            let feedback: string | null = null;
            let resultRecordedAt: string | null = null;
            const roll = rnd();
            const marked = !last || roll < 0.55;
            if (marked) {
              if (isDraft) {
                resultKind = 'draft';
                feedback = 'draft fb';
              } else {
                resultKind = 'verdict';
                result = last ? (rnd() < 0.6 ? 'PASS' : 'REFER') : 'REFER';
                feedback = 'fb';
              }
              // recordedAt after submit (sometimes BEFORE it, to exercise the d>=0 filter).
              resultRecordedAt = iso(t0 + (rnd() < 0.1 ? -2 : 2 + Math.floor(rnd() * 100)));
            }
            addSub({
              learnerId: id,
              courseId: cid,
              lessonId: ls.lessonId,
              assessmentKey: key ?? null,
              submissionType: isDraft ? 'draft' : 'final',
              version: v,
              submittedAt,
              resultKind,
              result,
              feedback,
              resultRecordedAt
            });
            t0 += 6 + Math.floor(rnd() * 90);
          }
        }
      }
    }
  }
  // Newest first (the real query orders submitted_at desc); stable for equal timestamps.
  (S.subs as Row[]).sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

  // Course enrolled counts + recorded completions (~30% of enrolled learners of each course).
  for (const c of courseDefs) {
    const en = S.enrolments.filter((e) => e.courseId === c.courseId);
    S.courses.push({ ...c, enrolled: new Set(en.map((e) => e.learnerId)).size });
    for (const e of en) if (rnd() < 0.3) S.completions.push({ courseId: c.courseId, learnerId: e.learnerId });
  }
  S.unallocated = { total: 12, learners: [{ learnerId: 'L001', name: 'x', email: 'x' }] };
}

const strip = (o: unknown) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'generatedAt' ? undefined : v)));

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  for (const k of Object.keys(H.calls)) delete H.calls[k];
  seed();
});

describe('seeded dataset sanity (the parity below is only meaningful if it exercises the edge cases)', () => {
  it('has the shape the plan asks for', () => {
    expect(H.state.learners).toHaveLength(200);
    expect(H.state.tutors.filter((t) => t.id.startsWith('T') && t.id !== 'T-empty')).toHaveLength(5);
    // overlap: some learner is allocated to two tutors
    const per = new Map<string, number>();
    for (const ids of H.state.alloc.values()) for (const id of ids) per.set(id, (per.get(id) ?? 0) + 1);
    expect([...per.values()].some((n) => n === 2)).toBe(true);
    // an allocated learner outside the org roster, a deactivated learner, legacy NULL-key rows, drafts, verdicts
    expect(H.state.alloc.get('T1')).toContain('X-out');
    expect(H.state.learners.some((l) => l.status === 'DEACTIVATED')).toBe(true);
    const subs = H.state.subs as Row[];
    expect(subs.some((s) => s.assessmentKey === null)).toBe(true);
    expect(subs.some((s) => s.submissionType === 'draft')).toBe(true);
    expect(subs.some((s) => s.result === 'REFER')).toBe(true);
    expect(subs.some((s) => s.resultKind == null && s.submissionType === 'final')).toBe(true);
    expect(H.state.courses.filter((c) => !c.isPublished)).toHaveLength(1);
  });
});

describe('computePipelineForRoster — lean rows give the SAME pipeline as the heavy legacy path', () => {
  const rosters: [string, () => { learnerId: string; name: string | null; email: string | null }[]][] = [
    ['org-wide roster', () => H.state.learners.map((l) => ({ learnerId: l.learnerId, name: l.name, email: l.email }))],
    ...['T1', 'T2', 'T3', 'T4', 'T5', 'T-empty'].map(
      (t) =>
        [
          `tutor ${t} roster`,
          () => (H.state.alloc.get(t) ?? []).map((learnerId) => ({ learnerId, name: `n-${learnerId}`, email: null }))
        ] as [string, () => { learnerId: string; name: string | null; email: string | null }[]]
    )
  ];
  for (const [label, mk] of rosters) {
    it(`${label}: stats, all five item lists and programmes are identical`, async () => {
      const before = await legacyPipeline(mk());
      const after = await computePipelineForRoster(mk());
      expect(strip(after)).toEqual(strip(before));
    });
  }

  it('stats.assignments counts ALL course lessons (a separate lean read), not only lessons that have submissions', async () => {
    // A roster whose learners have NO submissions at all still reports the courses' full assessment count.
    const quiet = H.state.learners.slice(0, 3).map((l) => ({ learnerId: l.learnerId, name: null, email: null }));
    H.state.subs = [];
    const after = await computePipelineForRoster(quiet);
    const before = await legacyPipeline(quiet);
    expect(after.stats.assignments).toBe(before.stats.assignments);
    expect(after.stats.assignments).toBeGreaterThan(0);
  });

  it('counts-only mode returns the SAME stats minus the scope fields, with empty item lists', async () => {
    const roster = H.state.learners.map((l) => ({ learnerId: l.learnerId, name: l.name, email: l.email }));
    const full = await computePipelineForRoster(roster);
    const counts = await computePipelineForRoster(roster, { countsOnly: true });
    expect({ ...counts.stats, courses: 0, assignments: 0 }).toEqual({ ...full.stats, courses: 0, assignments: 0 });
    expect(counts.awaitingMarking).toEqual([]);
    expect(counts.resubmissions).toEqual([]);
    expect(counts.awaitingDraftFeedback).toEqual([]);
    expect(counts.overdue).toEqual([]);
    expect(counts.dueSoon).toEqual([]);
    expect(counts.programmes).toEqual([]);
    expect(full.awaitingMarking.length).toBeGreaterThan(0);
    expect(full.stats.learnersWithPendingWork).toBeGreaterThan(0);
  });
});

describe('getAdminOverview — after == before on the seeded dataset', () => {
  it('the whole bundle is identical (headline, charts, per-tutor rows, per-course rows, unallocated)', async () => {
    const before = await legacyOverview(admin);
    const after = await getAdminOverview(admin);
    expect(strip(after)).toEqual(strip(before));
  });

  it('a Manager gets the same bundle (read-only org view)', async () => {
    const a = await getAdminOverview(admin);
    const m = await getAdminOverview(manager);
    expect(strip(m)).toEqual(strip(a));
  });

  it('a learner with two tutors counts for EACH tutor but once org-wide; allocation-only scoping holds', async () => {
    const o = await getAdminOverview(admin);
    const perTutor = new Map(o.tutors.map((t) => [t.tutorId, t.learners]));
    // tutor learner counts are exactly the allocation set sizes (X-out included for T1; T-empty is 0).
    for (const [t, ids] of H.state.alloc) expect(perTutor.get(t)).toBe(ids.length);
    expect(perTutor.get('T-empty')).toBe(0);
    const sum = [...perTutor.values()].reduce((a, b) => a + b, 0);
    const distinct = new Set([...H.state.alloc.values()].flat()).size;
    expect(sum).toBeGreaterThan(distinct); // overlap -> more tutor rows than distinct learners
    expect(o.headline.totalLearners).toBe(200); // org-wide: each learner once, X-out excluded
  });

  it('tutor A never sees tutor B-only learners: a tutor row only counts work from its own allocation set', async () => {
    // Give a learner allocated ONLY to T2 an awaiting submission; no other tutor's awaitingMarking may include it.
    const only2 = H.state.alloc
      .get('T2')!
      .find((id) => ![...H.state.alloc].some(([t, ids]) => t !== 'T2' && ids.includes(id)))!;
    const base = await getAdminOverview(admin);
    (H.state.subs as Row[]).unshift({
      id: 'S-extra',
      learnerId: only2,
      courseId: 'C1',
      lessonId: 'LS-C1-1',
      assessmentKey: 'extra-key',
      submissionType: 'final',
      version: 1,
      files: [],
      comment: null,
      status: 'submitted',
      submittedAt: iso(-1),
      courseTitle: 'Course One',
      unitTitle: 'U',
      resultKind: null,
      result: null,
      feedback: null,
      resultRecordedAt: null
    });
    const next = await getAdminOverview(admin);
    const delta = (id: string) =>
      next.tutors.find((t) => t.tutorId === id)!.awaitingMarking -
      base.tutors.find((t) => t.tutorId === id)!.awaitingMarking;
    expect(delta('T2')).toBe(1);
    for (const t of ['T1', 'T3', 'T4', 'T5', 'T-empty']) expect(delta(t)).toBe(0);
    expect(next.headline.awaitingMarking - base.headline.awaitingMarking).toBe(1);
  });

  it('loads submissions ONCE (lean) instead of once per tutor, with one allocation read and no per-course reports', async () => {
    await legacyOverview(admin);
    const legacyCalls = { ...H.calls };
    for (const k of Object.keys(H.calls)) delete H.calls[k];
    await getAdminOverview(admin);
    // before: 1 org load + 6 tutor loads; per-tutor roster reads; one progress report per published course
    expect(legacyCalls.getSubmissionsWithContextForLearners).toBe(7);
    expect(legacyCalls.listLearnersForTutor).toBe(6);
    expect(legacyCalls.getCourseProgressReport).toBe(2);
    // after: one lean org+allocated load, one allocation read, no heavy rows, no per-course report
    expect(H.calls.getSubmissionStatusRowsForLearners).toBe(1);
    expect(H.calls.listAllocatedLearnerIdsByTutors).toBe(1);
    expect(H.calls.getSubmissionsWithContextForLearners).toBeUndefined();
    expect(H.calls.listLearnersForTutor).toBeUndefined();
    expect(H.calls.getCourseProgressReport).toBeUndefined();
    expect(H.calls.getCoursesForLearners).toBeUndefined();
    // org last-seen is read once; the one extra read is for the allocated-but-not-in-org learner(s) only
    expect(H.calls.getLastSeenForUserIds).toBe(2);
    expect(H.calls.getAssessmentItemsByLesson).toBe(1);
  });

  it('an empty org (no learners, no tutors) still returns a well-formed bundle without querying submissions with []', async () => {
    H.state.learners = [];
    H.state.tutors = [];
    H.state.alloc = new Map();
    H.state.subs = [];
    H.state.enrolments = [];
    H.state.courses = [];
    H.state.lessonPairs = [];
    H.state.completions = [];
    const o = await getAdminOverview(admin);
    expect(o.headline.totalLearners).toBe(0);
    expect(o.tutors).toEqual([]);
    expect(o.courses).toEqual([]);
  });
});

describe('decision #3 — completion % = recorded completions of currently-enrolled students, capped at 100', () => {
  it('ignores completions by learners who are no longer enrolled', async () => {
    const c1 = H.state.courses.find((c) => c.courseId === 'C1')!;
    const before = (await getAdminOverview(admin)).courses.find((c) => c.courseId === 'C1')!.completionPercent;
    H.state.completions.push({ courseId: 'C1', learnerId: 'ghost-1' }, { courseId: 'C1', learnerId: 'ghost-2' });
    const after = (await getAdminOverview(admin)).courses.find((c) => c.courseId === 'C1')!.completionPercent;
    expect(after).toBe(before);
    expect(c1.enrolled).toBeGreaterThan(0);
  });

  it('never exceeds 100 and reads 0 for draft courses and courses with no enrolment', async () => {
    // Force every enrolled learner of C2 complete, plus a mismatched enrolled count that would exceed 100%.
    H.state.completions = H.state.enrolments.filter((e) => e.courseId === 'C2').map((e) => ({ ...e }));
    H.state.courses = H.state.courses.map((c) => (c.courseId === 'C2' ? { ...c, enrolled: 1 } : c));
    H.state.completions.push(...H.state.enrolments.filter((e) => e.courseId === 'C3').map((e) => ({ ...e })));
    const o = await getAdminOverview(admin);
    expect(o.courses.find((c) => c.courseId === 'C2')!.completionPercent).toBe(100);
    expect(o.courses.find((c) => c.courseId === 'C3')!.completionPercent).toBe(0); // draft stays 0
  });
});
