import { Hono } from '@api/utils/hono';
import { handleError } from '@api/utils/errors';
import { apiKeyMiddleware } from '@api/middlewares/api-key';
import { extractClientIp } from '@api/utils/redis/key-generators';
import { REGISTRATION_HONEYPOT_FIELD } from '@cio/utils/constants';
import { submitRegistration, listRegistrationCourses } from '@api/services/registration/registration';

// PearlLMS Phase 7 — the PUBLIC registration intake (docs/ONBOARDING-MODEL.md §8). Reachable only via the
// dashboard's server-side api-key call (apiKeyMiddleware) — the public browser never holds the key; the
// (auth)/register form action forwards the visitor's IP as x-forwarded-for so the per-IP rate limit + honeypot
// (both in the service) see the real client. These routes write ONLY a pending `registration` row (or nothing,
// for a honeypot/duplicate) — never a user or session. Mounted at /register.
export const registrationRouter = new Hono()
  // Published courses for the "course of interest" picker on the public form.
  .get('/courses', apiKeyMiddleware, async (c) => {
    try {
      const courses = await listRegistrationCourses();
      return c.json({ success: true, data: courses }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load courses');
    }
  })
  // Submit a registration → a pending application (never an account).
  .post('/', apiKeyMiddleware, async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const result = await submitRegistration({
        fullName: typeof body.fullName === 'string' ? body.fullName : '',
        email: typeof body.email === 'string' ? body.email : '',
        requestedCourseId: typeof body.requestedCourseId === 'string' ? body.requestedCourseId : null,
        honeypot:
          typeof body[REGISTRATION_HONEYPOT_FIELD] === 'string' ? (body[REGISTRATION_HONEYPOT_FIELD] as string) : null,
        clientIp: extractClientIp(c)
      });
      return c.json({ success: true, data: result }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to submit registration');
    }
  });
