import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

/**
 * Background work (docs/background-tasks.md). "Task" means a BullMQ job: the word "job" is
 * taken by the business domain (field-work jobs).
 *
 * API → queue (Redis) → worker. Modules define their tasks in onModuleInit; anything can
 * then enqueue them. Every instance enqueues; instances with WORKERS_ENABLED run them.
 *
 * Without Redis (or when enqueueing fails because Redis is down) a task runs in this
 * process right away, once, without retries: the behaviour before queues existed.
 */

export const QUEUE_NAMES = ['notifications', 'maintenance'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

/** Tasks that could not be completed after every attempt, kept for inspection. */
export const DEAD_LETTER_QUEUE = 'dead-letter';

/** Tasks of a queue processed at the same time by one worker. */
const CONCURRENCY: Readonly<Record<QueueName, number>> = {
  // Network-bound (FCM): many in parallel.
  notifications: 10,
  // Database sweeps: one at a time.
  maintenance: 1,
};

export interface TaskDefinition<Data> {
  /** Unique, dot-separated: "push.send". */
  readonly name: string;
  readonly queue: QueueName;
  /** Tries in total, including the first. Retries back off exponentially. */
  readonly attempts: number;
  /** Runs the task on this schedule (milliseconds); undefined or 0: only when enqueued. */
  readonly everyMs?: number;
  /**
   * Does the work. Throwing schedules a retry (until `attempts` run out); throw
   * `PermanentTaskError` for failures a retry cannot fix. Must be idempotent: a task can run
   * more than once (a worker may stop after the work but before recording it).
   */
  readonly run: (data: Data, attempt: number) => Promise<void>;
}

/** A failure that retrying will not fix: no further attempts. */
export class PermanentTaskError extends Error {
  // BullMQ recognises this name and stops retrying.
  override readonly name = 'UnrecoverableError';
}

export interface EnqueueOptions {
  /** Deduplication: a task with the same ID is not added again while BullMQ keeps it. */
  readonly id?: string;
  /** 1 is the highest; tasks without a priority run before prioritised ones. */
  readonly priority?: number;
}

export interface DeadLetter {
  readonly queue: string;
  readonly name: string;
  readonly data: unknown;
  readonly error: string;
  readonly attempts: number;
  readonly failedAt: string;
}

/**
 * BullMQ waits for its connection to be ready, forever. These bound every wait, so a Redis
 * outage degrades to inline execution instead of hanging requests, startup or shutdown.
 */
const ENQUEUE_TIMEOUT_MS = 2_000;
const CLOSE_TIMEOUT_MS = 10_000;

/** Finished tasks kept for inspection, then removed by BullMQ. */
const KEEP_COMPLETED = { age: 3_600, count: 1_000 };
const KEEP_FAILED = { age: 7 * 86_400, count: 5_000 };

@Injectable()
export class BackgroundTasks
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(BackgroundTasks.name);
  private readonly definitions = new Map<string, TaskDefinition<unknown>>();
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];
  private readonly timers: NodeJS.Timeout[] = [];
  /** Producer connection: fails fast while Redis is down (then the task runs inline). */
  private readonly connection: Redis | null;
  private readonly workerConnections: Redis[] = [];
  private readonly prefix: string;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.prefix = `${config.redis.keyPrefix}bull`;
    this.connection =
      config.redis.url === undefined
        ? null
        : new Redis(config.redis.url, {
            enableOfflineQueue: false,
            maxRetriesPerRequest: 1,
            connectTimeout: 5_000,
            retryStrategy: attempt => Math.min(attempt * 500, 5_000),
          });
    // Errors surface on each command; logging every reconnection attempt adds nothing.
    this.connection?.on('error', () => undefined);
  }

  /** Called by the owning module in onModuleInit. */
  define<Data>(definition: TaskDefinition<Data>): void {
    if (this.definitions.has(definition.name)) {
      throw new Error(`Task ${definition.name} is defined twice.`);
    }
    // Data is checked where the task is defined and enqueued with the same type argument.
    this.definitions.set(
      definition.name,
      definition as unknown as TaskDefinition<unknown>,
    );
  }

  /**
   * Adds a task. Never throws: if the queue is unreachable, the task runs here and now
   * (once). Resolves when the task is queued (or, inline, started).
   */
  async enqueue<Data>(
    name: string,
    data: Data,
    options: EnqueueOptions = {},
  ): Promise<void> {
    const definition = this.definition(name);
    if (this.connection?.status === 'ready') {
      try {
        // If the add times out but lands later, the task runs twice (inline and queued):
        // tasks are idempotent, and at-least-once is the contract anyway.
        await withTimeout(
          this.queue(definition.queue).add(name, data, {
            ...(options.id !== undefined && { jobId: options.id }),
            ...(options.priority !== undefined && {
              priority: options.priority,
            }),
            attempts: definition.attempts,
            backoff: {
              type: 'exponential',
              delay: this.config.queue.retryDelayMs,
            },
            removeOnComplete: KEEP_COMPLETED,
            removeOnFail: KEEP_FAILED,
          }),
          ENQUEUE_TIMEOUT_MS,
        );
        return;
      } catch (error) {
        this.logger.warn(
          `Queue unavailable, running ${name} inline: ${messageOf(error)}`,
        );
      }
    }
    this.runInline(definition, data);
  }

  onApplicationBootstrap(): void {
    if (this.connection === null) {
      this.startInlineSchedules();
      return;
    }
    // Registered whenever the connection becomes ready (at startup, or once Redis is back),
    // never awaited: startup must not wait for Redis.
    this.connection.on('ready', () => void this.applySchedules());
    if (this.connection.status === 'ready') {
      void this.applySchedules();
    }
    if (this.config.queue.workersEnabled) {
      for (const queue of QUEUE_NAMES) {
        this.startWorker(queue);
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    // Workers first: they finish their current task before closing (bounded: with Redis
    // down a graceful close would wait forever).
    await Promise.allSettled(
      this.workers.map(worker =>
        withTimeout(worker.close(), CLOSE_TIMEOUT_MS).catch(() =>
          worker.close(true),
        ),
      ),
    );
    await Promise.allSettled(
      [...this.queues.values()].map(queue =>
        withTimeout(queue.close(), CLOSE_TIMEOUT_MS),
      ),
    );
    for (const connection of [...this.workerConnections, this.connection]) {
      connection?.disconnect();
    }
  }

  /** The queue's handle, for tests and diagnostics (counts, failed tasks). */
  queue(name: QueueName | typeof DEAD_LETTER_QUEUE): Queue {
    let queue = this.queues.get(name);
    if (queue === undefined) {
      if (this.connection === null) {
        throw new Error('Queues need Redis (REDIS_URL).');
      }
      queue = new Queue(name, {
        connection: this.connection,
        prefix: this.prefix,
      });
      // A failing Redis is reported by the commands themselves.
      queue.on('error', () => undefined);
      this.queues.set(name, queue);
    }
    return queue;
  }

  private definition(name: string): TaskDefinition<unknown> {
    const definition = this.definitions.get(name);
    if (definition === undefined) {
      throw new Error(`Unknown task ${name}.`);
    }
    return definition;
  }

  private runInline(definition: TaskDefinition<unknown>, data: unknown): void {
    definition
      .run(data, 1)
      .catch((error: unknown) =>
        this.logger.error(
          `Task ${definition.name} failed (inline, not retried)`,
          error instanceof Error ? error.stack : String(error),
        ),
      );
  }

  /**
   * Registers each scheduled task with BullMQ (or removes a schedule that was turned off).
   * The scheduler lives in Redis, so however many instances start, each tick runs once.
   */
  private async applySchedules(): Promise<void> {
    for (const definition of this.definitions.values()) {
      const schedulerId = `every.${definition.name}`;
      const queue = this.queue(definition.queue);
      try {
        if (definition.everyMs !== undefined && definition.everyMs > 0) {
          await queue.upsertJobScheduler(
            schedulerId,
            { every: definition.everyMs },
            {
              name: definition.name,
              data: {},
              opts: {
                attempts: definition.attempts,
                removeOnComplete: KEEP_COMPLETED,
                removeOnFail: KEEP_FAILED,
              },
            },
          );
        } else {
          await queue.removeJobScheduler(schedulerId);
        }
      } catch (error) {
        this.logger.error(
          `Could not schedule ${definition.name}: ${messageOf(error)}`,
        );
      }
    }
  }

  private startInlineSchedules(): void {
    for (const definition of this.definitions.values()) {
      if (definition.everyMs !== undefined && definition.everyMs > 0) {
        const timer = setInterval(
          () => this.runInline(definition, {}),
          definition.everyMs,
        );
        timer.unref();
        this.timers.push(timer);
      }
    }
  }

  private startWorker(queueName: QueueName): void {
    const url = this.config.redis.url;
    if (url === undefined) {
      return;
    }
    // Workers block on Redis, so BullMQ requires their connection to retry forever.
    const connection = new Redis(url, { maxRetriesPerRequest: null });
    connection.on('error', () => undefined);
    this.workerConnections.push(connection);

    const worker = new Worker(
      queueName,
      async (task: Job) =>
        this.definition(task.name).run(task.data, task.attemptsMade + 1),
      {
        connection,
        prefix: this.prefix,
        concurrency: CONCURRENCY[queueName],
      },
    );
    worker.on('failed', (task, error) => {
      if (task !== undefined) {
        void this.onFailed(queueName, task, error);
      }
    });
    worker.on('error', error =>
      this.logger.error(`Worker ${queueName}: ${error.message}`),
    );
    this.workers.push(worker);
  }

  /** A retry is coming, or the task is dead: then it is copied to the dead-letter queue. */
  private async onFailed(
    queueName: QueueName,
    task: Job,
    error: Error,
  ): Promise<void> {
    const attempts = task.opts.attempts ?? 1;
    const permanent = error.name === 'UnrecoverableError';
    if (!permanent && task.attemptsMade < attempts) {
      this.logger.warn(
        `Task ${task.name} failed (attempt ${task.attemptsMade} of ${attempts}), retrying: ${error.message}`,
      );
      return;
    }
    this.logger.error(
      `Task ${task.name} failed for good after ${task.attemptsMade} attempt(s): ${error.message}`,
    );
    const letter: DeadLetter = {
      queue: queueName,
      name: task.name,
      data: task.data,
      error: error.message,
      attempts: task.attemptsMade,
      failedAt: new Date().toISOString(),
    };
    try {
      await this.queue(DEAD_LETTER_QUEUE).add(task.name, letter, {
        removeOnComplete: true,
        removeOnFail: false,
      });
    } catch (deadLetterError) {
      this.logger.error(
        `Could not record ${task.name} in the dead-letter queue: ${messageOf(deadLetterError)}`,
      );
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Redis did not answer within ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
