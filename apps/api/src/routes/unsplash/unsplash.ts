import { Hono } from '@api/utils/hono';
import { createRateLimiter } from '@api/middlewares/rate-limiter';
import { extractClientIp } from '@api/utils/redis/key-generators';
import { UNAUTH_PROXY_RATE_LIMIT } from '@cio/utils/constants';
import { env } from '@cio/core/config/env';
import { handleError } from '@api/utils/errors';
import { z } from 'zod';

const ZUnsplashRequest = z.object({
  searchQuery: z.string().optional()
});

// PearlLMS Phase-10 HP/D14 — public third-party proxy: cap per IP (O3: 20/hour) so it can't be used to burn the
// shared Unsplash API quota / as an open request relay.
const unsplashRateLimit = createRateLimiter({
  windowMs: UNAUTH_PROXY_RATE_LIMIT.windowMs,
  maxRequests: UNAUTH_PROXY_RATE_LIMIT.maxPerWindow,
  message: 'Too many requests. Please try again later.',
  keyGenerator: (c) => `unsplash:${extractClientIp(c)}`
});

export const unsplashRouter = new Hono()
  /**
   * POST /unsplash
   * Fetches photos from Unsplash API
   * No authentication required - public route (rate-limited per IP, HP/D14)
   */
  .post('/', unsplashRateLimit, async (c) => {
    try {
      const body = await c.req.json();
      const validatedData = ZUnsplashRequest.parse(body);

      const query = validatedData.searchQuery || 'rocks';
      const UNSPLASH_API_URL = `https://api.unsplash.com/search/photos?page=2&per_page=15&auto=format&fit=crop&w=2970&q=80&client_id=${env.UNSPLASH_API_KEY}`;

      const response = await fetch(`${UNSPLASH_API_URL}&query=${encodeURIComponent(query)}`, {
        method: 'GET'
      });

      if (!response.ok) {
        throw new Error('Unable to fetch photos from Unsplash API');
      }

      const data = await response.json();

      return c.json({
        success: true,
        photos: data.results
      });
    } catch (error) {
      console.error('Error fetching photos from Unsplash', error);
      return handleError(c, error, 'Error fetching photos from Unsplash');
    }
  });
