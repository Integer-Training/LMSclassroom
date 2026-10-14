import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// PearlLMS — the admin-only Tutor Feedback report. Proves (a) ADMIN-only authz (Manager/Tutor/Learner denied,
// anon unauthorized); (b) the aggregation: per-tutor averages (overall + nullable dimensions), grouping by
// tutor id with the snapshot-name fallback for a removed tutor, sort by avg desc then count, and the totals.
// The DB query layer is mocked so only the service logic is exercised (no database).

vi.mock('@cio/db/queries/tutor-feedback', () => ({ getOrgTutorFeedback: vi.fn() }));

import { getOrgTutorFeedback } from '@cio/db/queries/tutor-feedback';
import { getTutorFeedbackReport } from '@api/services/dash/reports';

const ORG = 'org-1';
const A = (id: string, role: string): Actor =>
  ({ authenticated: true, userId: id, role, status: 'ACTIVE', orgId: ORG }) as Actor;

function primeRows() {
  vi.mocked(getOrgTutorFeedback).mockResolvedValue([
    {
      id: 'f1',
      learnerId: 'l1',
      learnerName: 'Anna',
      tutorId: 't1',
      tutorName: 'Tutor One',
      milestone: 2,
      overallRating: 5,
      communicationRating: 4,
      helpfulnessRating: null,
      knowledgeRating: 5,
      comment: 'great',
      createdAt: '2026-10-10T09:00:00Z'
    },
    {
      id: 'f2',
      learnerId: 'l2',
      learnerName: null,
      tutorId: 't1',
      tutorName: 'Tutor One',
      milestone: 7,
      overallRating: 3,
      communicationRating: null,
      helpfulnessRating: null,
      knowledgeRating: 5,
      comment: null,
      createdAt: '2026-10-09T09:00:00Z'
    },
    {
      id: 'f3',
      learnerId: 'l1',
      learnerName: 'Anna',
      tutorId: 't2',
      tutorName: 'Tutor Two',
      milestone: 2,
      overallRating: 4,
      communicationRating: 4,
      helpfulnessRating: 4,
      knowledgeRating: 4,
      comment: 'ok',
      createdAt: '2026-10-08T09:00:00Z'
    },
    {
      id: 'f4',
      learnerId: 'l3',
      learnerName: 'Cara',
      tutorId: null,
      tutorName: 'Removed Tutor',
      milestone: 2,
      overallRating: 2,
      communicationRating: 2,
      helpfulnessRating: null,
      knowledgeRating: null,
      comment: null,
      createdAt: '2026-10-07T09:00:00Z'
    }
  ] as never);
}

beforeEach(() => vi.clearAllMocks());

describe('getTutorFeedbackReport — ADMIN only', () => {
  beforeEach(primeRows);

  it('Admin is allowed', async () => {
    await expect(getTutorFeedbackReport(A('u-admin', 'ADMIN'))).resolves.toBeTruthy();
  });
  it('Manager is denied (403)', async () => {
    await expect(getTutorFeedbackReport(A('u', 'MANAGER'))).rejects.toThrowError('Admins only');
  });
  it('Tutor is denied (403)', async () => {
    await expect(getTutorFeedbackReport(A('u', 'TUTOR'))).rejects.toThrowError('Admins only');
  });
  it('Learner is denied (403)', async () => {
    await expect(getTutorFeedbackReport(A('u', 'LEARNER'))).rejects.toThrowError('Admins only');
  });
  it('Anonymous is unauthorized (401)', async () => {
    await expect(getTutorFeedbackReport({ authenticated: false } as Actor)).rejects.toThrowError('Unauthorized');
  });
});

describe('getTutorFeedbackReport — aggregation', () => {
  beforeEach(primeRows);

  it('per-tutor: overall + nullable dimension averages, snapshot-name fallback, sorted by avg then count', async () => {
    const r = await getTutorFeedbackReport(A('u-admin', 'ADMIN'));
    // t1 avg = (5+3)/2 = 4 (count 2) ties t2 avg 4 (count 1) → t1 first by count; removed last by avg.
    expect(r.perTutor.map((t) => t.name)).toEqual(['Tutor One', 'Tutor Two', 'Removed Tutor']);
    expect(r.perTutor[0]).toMatchObject({
      tutorId: 't1',
      count: 2,
      avgOverall: 4,
      avgCommunication: 4, // only one non-null (4)
      avgHelpfulness: null, // none present
      avgKnowledge: 5 // (5+5)/2
    });
    expect(r.perTutor[2]).toMatchObject({ tutorId: null, name: 'Removed Tutor', avgOverall: 2 });
  });

  it('entries: learner-name fallback, newest-first order preserved from the query', async () => {
    const r = await getTutorFeedbackReport(A('u-admin', 'ADMIN'));
    expect(r.entries.map((e) => e.id)).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(r.entries[1].learnerName).toBe('Unknown learner');
  });

  it('totals: count, distinct tutors, distinct responders, overall average', async () => {
    const r = await getTutorFeedbackReport(A('u-admin', 'ADMIN'));
    expect(r.totals).toEqual({ totalFeedback: 4, tutorsRated: 3, learnersResponded: 3, avgOverall: 3.5 });
  });

  it('empty org: zeros, empty lists, no crash', async () => {
    vi.mocked(getOrgTutorFeedback).mockResolvedValue([] as never);
    const r = await getTutorFeedbackReport(A('u-admin', 'ADMIN'));
    expect(r.totals).toEqual({ totalFeedback: 0, tutorsRated: 0, learnersResponded: 0, avgOverall: 0 });
    expect(r.perTutor).toEqual([]);
    expect(r.entries).toEqual([]);
  });
});
