import { Hono } from '@api/utils/hono';
import { createPaymentRequest } from '@api/services/course/payment-request';
import { createRateLimiter } from '@api/middlewares/rate-limiter';
import { extractClientIp } from '@api/utils/redis/key-generators';
import { UNAUTH_EMAIL_RATE_LIMIT } from '@cio/utils/constants';
import { handleError } from '@api/utils/errors';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

const ZPaymentRequest = z.object({
  studentEmail: z.string().email(),
  studentFullname: z.string().min(1)
});

// PearlLMS Phase-10 HP/D14 — this public endpoint sends emails to an attacker-suppliable address, so cap it per
// IP (O3: 5/hour) to stop it being used as an outbound-email / inbox-spam amplifier.
const paymentRequestRateLimit = createRateLimiter({
  windowMs: UNAUTH_EMAIL_RATE_LIMIT.windowMs,
  maxRequests: UNAUTH_EMAIL_RATE_LIMIT.maxPerWindow,
  message: 'Too many payment requests. Please try again later.',
  keyGenerator: (c) => `payment_request:${extractClientIp(c)}`
});

export const paymentRequestRouter = new Hono()
  /**
   * POST /course/:courseId/payment-request
   * Creates a payment request and sends emails to teacher and student
   * No authentication required - public route for course landing pages (rate-limited per IP, HP/D14)
   */
  .post('/', paymentRequestRateLimit, zValidator('json', ZPaymentRequest), async (c) => {
    try {
      const courseId = c.req.param('courseId')!;
      const data = c.req.valid('json');

      const result = await createPaymentRequest({
        courseId,
        studentEmail: data.studentEmail,
        studentFullname: data.studentFullname
      });

      return c.json(
        {
          success: true,
          data: result
        },
        200
      );
    } catch (error) {
      return handleError(c, error, 'Failed to create payment request');
    }
  });
