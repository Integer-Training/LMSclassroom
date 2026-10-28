import { FlowProducer, Queue } from 'bullmq';

import { closeSharedRedisConnection, ensureProducerReady, getSharedRedisConnection } from '../connection';
import { QUEUE_NAMES, type QueueName } from './names';
import { buildQueueOptions } from './defaults';

/**
 * Lazy queue + flow-producer accessors backed by the shared Redis
 * connection. Workers should NOT use these — they need their own Redis
 * connection per process. These are for the API enqueue path.
 */

/**
 * Producer queue that rejects fast (instead of hanging) when Redis is unreachable; see `ensureProducerReady`.
 * Only the entry points that talk to Redis for a write are gated — reads already fail fast on the producer connection.
 */
class ProducerQueue extends Queue {
  override async add(...args: Parameters<Queue['add']>): ReturnType<Queue['add']> {
    await ensureProducerReady();
    return super.add(...args);
  }

  override async addBulk(...args: Parameters<Queue['addBulk']>): ReturnType<Queue['addBulk']> {
    await ensureProducerReady();
    return super.addBulk(...args);
  }
}

class ProducerFlowProducer extends FlowProducer {
  override async add(...args: Parameters<FlowProducer['add']>): ReturnType<FlowProducer['add']> {
    await ensureProducerReady();
    return super.add(...args);
  }
}

const queues = new Map<QueueName, Queue>();
let flowProducer: FlowProducer | undefined;

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new ProducerQueue(name, {
      ...buildQueueOptions(name),
      connection: getSharedRedisConnection()
    });
    queue.on('error', (error) => {
      console.error(`BullMQ queue error (${name}):`, error);
    });
    queues.set(name, queue);
  }

  return queue;
}

export function getFlowProducer(): FlowProducer {
  if (!flowProducer) {
    flowProducer = new ProducerFlowProducer({ connection: getSharedRedisConnection() });
    flowProducer.on('error', (error) => {
      console.error('BullMQ flow producer error:', error);
    });
  }

  return flowProducer;
}

/** Eagerly close every cached queue/flow producer. Useful in tests. */
export async function closeAllQueues(): Promise<void> {
  await Promise.all(Array.from(queues.values()).map((queue) => queue.close()));
  queues.clear();

  if (flowProducer) {
    await flowProducer.close();
    flowProducer = undefined;
  }

  await closeSharedRedisConnection();
}

/** Returns every queue name in registration order. */
export function listQueueNames(): QueueName[] {
  return Object.values(QUEUE_NAMES);
}
