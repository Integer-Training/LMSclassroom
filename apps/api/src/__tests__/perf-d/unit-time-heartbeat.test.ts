import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';

// PearlLMS scalability Phase D — the learner unit-time heartbeat (PUT /:lessonId/time) takes a cheap path:
// staff return before ANY lookup and write nothing; a learner needs one check (enrolled STUDENT of :courseId AND
// the lesson belongs to :courseId); a forged lessonId from another course is a 404 and writes nothing; the
// heavy content-lock assert is no longer run per beat; the 120s per-beat cap is kept.

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
  process.env.PRIVATE_DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
});

const actorRef: { current: Actor } = { current: { authenticated: false } as Actor };

vi.mock('@api/middlewares/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('user', { id: 'u-learner' });
    c.set('actor', actorRef.current);
    await next();
  }
}));
vi.mock('@api/middlewares/course-member', () => ({ courseMemberMiddleware: async (_c: any, next: any) => next() }));
vi.mock('@api/middlewares/rate-limiter', () => ({ createRateLimiter: () => async (_c: any, next: any) => next() }));
vi.mock('@api/services/course/access', () => ({ assertEnrolledStudentContentAccess: vi.fn(async () => undefined) }));
vi.mock('@cio/db/queries/caseload', () => ({
  addUnitTimeSpent: vi.fn(async () => undefined),
  getUnitTimeBeatTarget: vi.fn()
}));

import { addUnitTimeSpent, getUnitTimeBeatTarget } from '@cio/db/queries/caseload';
import { assertEnrolledStudentContentAccess } from '@api/services/course/access';
import { lessonRouter } from '@api/routes/course/lesson';

const COURSE = '11111111-1111-4111-8111-111111111111';
const LESSON = '22222222-2222-4222-8222-222222222222';
const app = new Hono().route('/course/:courseId/lesson', lessonRouter as unknown as Hono);

const actor = (role: string): Actor =>
  ({ authenticated: true, userId: 'u-learner', role, status: 'ACTIVE', orgId: 'o1' }) as Actor;

const beat = (seconds: number) =>
  app.request(`/course/${COURSE}/lesson/${LESSON}/time`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seconds })
  });

beforeEach(() => {
  vi.clearAllMocks();
  actorRef.current = actor('LEARNER');
  vi.mocked(getUnitTimeBeatTarget).mockResolvedValue('OK');
});

describe('PUT /course/:courseId/lesson/:lessonId/time', () => {
  it('records a learner beat after ONE cheap check, without the heavy content-lock assert', async () => {
    const res = await beat(30);

    expect(res.status).toBe(200);
    expect(getUnitTimeBeatTarget).toHaveBeenCalledWith({ courseId: COURSE, lessonId: LESSON, profileId: 'u-learner' });
    expect(assertEnrolledStudentContentAccess).not.toHaveBeenCalled();
    expect(addUnitTimeSpent).toHaveBeenCalledWith({
      learnerId: 'u-learner',
      courseId: COURSE,
      lessonId: LESSON,
      seconds: 30
    });
  });

  it('keeps the 120s per-beat cap', async () => {
    await beat(500); // validation allows up to 600; the route caps each beat at 120
    expect(addUnitTimeSpent).toHaveBeenCalledWith(expect.objectContaining({ seconds: 120 }));
  });

  it.each(['TUTOR', 'MANAGER', 'ADMIN'])('%s writes nothing and does no lookup at all', async (role) => {
    actorRef.current = actor(role);
    const res = await beat(30);

    expect(res.status).toBe(200);
    expect(getUnitTimeBeatTarget).not.toHaveBeenCalled();
    expect(assertEnrolledStudentContentAccess).not.toHaveBeenCalled();
    expect(addUnitTimeSpent).not.toHaveBeenCalled();
  });

  it('a lessonId from another course is a 404 and writes nothing', async () => {
    vi.mocked(getUnitTimeBeatTarget).mockResolvedValue('LESSON_NOT_IN_COURSE');
    const res = await beat(30);

    expect(res.status).toBe(404);
    expect(addUnitTimeSpent).not.toHaveBeenCalled();
  });

  it('a learner who is not an enrolled student of the course writes nothing', async () => {
    vi.mocked(getUnitTimeBeatTarget).mockResolvedValue('NOT_ENROLLED_STUDENT');
    const res = await beat(30);

    expect(res.status).toBe(200);
    expect(addUnitTimeSpent).not.toHaveBeenCalled();
  });
});
