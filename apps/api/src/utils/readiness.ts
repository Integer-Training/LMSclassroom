import type { Context } from 'hono';
import { db } from '@cio/db/drizzle';
import { redis } from '@cio/core/utils/redis/redis';
import { sql } from 'drizzle-orm';
import { withTimeout } from '@api/utils/with-timeout';

const READINESS_CHECK_TIMEOUT_MS = 2_000;

export type ReadinessResult = {
  ready: boolean;
  checks: { db: 'ok' | 'fail'; redis: 'ok' | 'fail' };
};

/**
 * Readiness probe for MONITORING ONLY (uptime check / alerts): `select 1` against Postgres and a PING against Redis,
 * each bounded to 2s. Never wire this to autoheal or a restart policy: a Supabase or Redis blip must page a human, not
 * restart a healthy api. Liveness stays `/health` (dependency-free). Returns booleans only, never error text.
 */
export async function checkReadiness(): Promise<ReadinessResult> {
  const [dbOk, redisOk] = await Promise.all([
    withTimeout(db.execute(sql`select 1`), READINESS_CHECK_TIMEOUT_MS, 'readiness db check').then(
      () => true,
      () => false
    ),
    redis.isReady
      ? withTimeout(redis.ping(), READINESS_CHECK_TIMEOUT_MS, 'readiness redis check').then(
          () => true,
          () => false
        )
      : Promise.resolve(false)
  ]);

  return {
    ready: dbOk && redisOk,
    checks: { db: dbOk ? 'ok' : 'fail', redis: redisOk ? 'ok' : 'fail' }
  };
}

/** `GET /ready`: 200 when both dependencies answer, else 503 with the failing one marked `fail`. */
export async function readyHandler(c: Context) {
  const result = await checkReadiness();

  return c.json(
    { status: result.ready ? 'ok' : 'unavailable', service: 'api', checks: result.checks },
    result.ready ? 200 : 503
  );
}
