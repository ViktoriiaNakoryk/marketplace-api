import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import Redis from 'ioredis';

export const NOTIFICATIONS_QUEUE = 'notifications';
export const ORDER_CONFIRMATION = 'order-confirmation';
export const REFRESH_PRODUCT_STATS = 'refresh-product-stats';
export const PRODUCT_STATS_SCHEDULER = 'product-stats-refresh';

export const notificationJobOptions: JobsOptions = {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1_000, jitter: 0.5 },
    removeOnComplete: { age: 24 * 3600, count: 10_000 },
    removeOnFail: { age: 7 * 24 * 3600 },
};

export function createNotificationsQueue(
    connection: Redis,
    name = NOTIFICATIONS_QUEUE,
    defaultJobOptions: JobsOptions = notificationJobOptions,
): Queue {
    return new Queue(name, { connection, defaultJobOptions });
}

export function orderConfirmationJobId(orderId: number): string {
    return `${ORDER_CONFIRMATION}-${orderId}`;
}

export function enqueueOrderConfirmation(queue: Queue, orderId: number) {
    return queue.add(ORDER_CONFIRMATION, { orderId }, { jobId: orderConfirmationJobId(orderId) });
}

export function upsertSchedulers(queue: Queue, everyMs = 5 * 60_000) {
    return queue.upsertJobScheduler(PRODUCT_STATS_SCHEDULER, { every: everyMs }, { name: REFRESH_PRODUCT_STATS, data: {} });
}

export type Processors = Record<string, (job: Job) => Promise<unknown>>;

export function createNotificationsWorker(url: string, processors: Processors, name = NOTIFICATIONS_QUEUE): Worker {
    const connection = new Redis(url, { maxRetriesPerRequest: null });
    const worker = new Worker(
        name,
        async (job) => {
            const processor = processors[job.name];
            if (!processor) throw new Error(`no processor for job "${job.name}"`);
            return processor(job);
        },
        { connection, concurrency: 5 },
    );
    worker.on('closed', () => connection.disconnect());
    return worker;
}
