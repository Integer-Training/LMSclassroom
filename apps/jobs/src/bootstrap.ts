import 'dotenv/config';

import { env } from './config/env';
import { warnIfFfmpegMissing } from './utils/ffmpeg';
import { log } from './utils/logger';
import { connectRedis, redis } from '@cio/core/utils/redis/redis';
import { closeDb } from '@cio/db';
import { closeAllQueues, configureProducerFailFast } from '@cio/jobs';
import { killActiveFfmpegProcesses } from './utils/ffmpeg';
import { createShutdown, resolveShutdownTimeoutMs } from './utils/shutdown';

// The jobs process also enqueues (reminder scan -> emails). It rides out Redis blips on the resilient default
// connection instead of the API's fail-fast producer connection, so scheduled work is not dropped.
configureProducerFailFast(false);

void warnIfFfmpegMissing();

if (!env.REDIS_URL) {
  throw new Error('REDIS_URL is required to start a worker process.');
}

void connectRedis();

log.info('worker-bootstrap', {
  nodeEnv: env.NODE_ENV,
  pid: process.pid,
  hasOpenAi: Boolean(env.OPENAI_API_KEY)
});

// One shutdown for every worker in this process (workers register their close task via registerShutdownTask).
const shutdown = createShutdown({
  timeoutMs: resolveShutdownTimeoutMs(process.env.SHUTDOWN_TIMEOUT),
  killChildren: killActiveFfmpegProcesses,
  afterWorkers: async () => {
    await Promise.allSettled([closeAllQueues(), redis.isOpen ? redis.quit() : undefined]);
    await closeDb(5);
  },
  exit: (code) => process.exit(code),
  log: (message, detail) => log.info(message, detail)
});

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// A genuinely uncaught exception leaves the process in an unknown state: log it and exit so `restart: unless-stopped`
// brings up a clean one (BullMQ re-delivers whatever was in flight). A stray rejected promise is only logged.
process.on('uncaughtException', (error) => {
  log.error('uncaught-exception', { message: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log.error('unhandled-rejection', { reason: reason instanceof Error ? reason.message : String(reason) });
});
