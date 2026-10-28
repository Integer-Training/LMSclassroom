import { logRedisUnavailableOnce, redis } from '@cio/core/utils/redis/redis';
import { REDIS_CACHE_TIMEOUT_MS, withTimeout } from '@cio/core/utils/with-timeout';

const KEY = (token: string) => `oauth-handoff:${token}`;
const TTL_SECONDS = 120; // OAuth callbacks usually finish in < 2s; 2 minutes gives plenty of slack.

export async function storeHandoffPayload(token: string, payload: string): Promise<void> {
  try {
    await withTimeout(
      redis.set(KEY(token), payload, { EX: TTL_SECONDS }),
      REDIS_CACHE_TIMEOUT_MS,
      'oauth-handoff write'
    );
  } catch (error) {
    logRedisUnavailableOnce('Redis SET oauth-handoff failed', error);
    throw new Error('Failed to store OAuth handoff payload');
  }
}

export async function consumeHandoffPayload(token: string): Promise<string | null> {
  try {
    const value = await withTimeout(redis.get(KEY(token)), REDIS_CACHE_TIMEOUT_MS, 'oauth-handoff read');
    if (value) {
      // Single-use: delete on read so the token can't be replayed.
      await withTimeout(redis.del(KEY(token)), REDIS_CACHE_TIMEOUT_MS, 'oauth-handoff delete');
    }
    return value;
  } catch (error) {
    logRedisUnavailableOnce('Redis GET oauth-handoff failed', error);
    return null;
  }
}
