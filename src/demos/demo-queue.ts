import type { Job } from 'bullmq';
import { createNotificationsQueue, createNotificationsWorker, notificationJobOptions, orderConfirmationJobId, ORDER_CONFIRMATION } from '../queue/notifications.queue';
import { configValue, connectRedis, requiredEnv } from '../redis/redis';
import { Checks, demoTag, run, sleep } from './redis-demo';

const FAIL_TIMES = 2;
const SCHEDULER_EVERY_MS = 500;
const OBSERVE_MS = 3_000;

run(async () => {
    const checks = new Checks('demo:queue');
    const url = requiredEnv('REDIS_QUEUE_URL');
    const connection = connectRedis(url);
    const policy = await configValue(connection, 'maxmemory-policy');
    console.log(`# queue instance: maxmemory-policy=${policy}`);

    const name = `notifications-demo-${demoTag()}`;
    const queue = createNotificationsQueue(connection, name, {
        ...notificationJobOptions,
        attempts: 5,
        backoff: { type: 'exponential', delay: 100, jitter: 0.5 },
    });

    try {
        let added = 0;
        const orderId = 42;
        await queue.add(ORDER_CONFIRMATION, { orderId }, { jobId: orderConfirmationJobId(orderId) });
        added++;
        await queue.add(ORDER_CONFIRMATION, { orderId }, { jobId: orderConfirmationJobId(orderId) });
        added++;
        const queued = await queue.count();
        console.log(`# two add() with jobId=${orderConfirmationJobId(orderId)} → ${queued} job(s) waiting`);

        await queue.upsertJobScheduler('demo-tick', { every: SCHEDULER_EVERY_MS }, { name: 'tick', data: {} });
        await queue.upsertJobScheduler('demo-tick', { every: SCHEDULER_EVERY_MS }, { name: 'tick', data: {} });
        const schedulers = await queue.getJobSchedulersCount();

        let attempts = 0;
        let scheduledRuns = 0;
        const confirmations = new Set<number>();
        const worker = createNotificationsWorker(
            url,
            {
                flaky: async (job: Job) => {
                    attempts++;
                    if (job.attemptsMade < FAIL_TIMES) throw new Error(`webhook answered 503 (attempt ${job.attemptsMade + 1})`);
                    return 'delivered';
                },
                tick: async () => {
                    scheduledRuns++;
                },
                [ORDER_CONFIRMATION]: async (job: Job) => {
                    confirmations.add(job.data.orderId);
                },
            },
            name,
        );
        worker.on('failed', (job, err) => console.log(`# ${job?.name} failed: ${err.message}`));

        const started = Date.now();
        const flaky = await queue.add('flaky', { webhook: 'https://partner.example/orders' }, { jobId: 'flaky-webhook' });
        const finished = await new Promise<string>((resolve) => {
            worker.on('completed', (job) => job.id === flaky.id && resolve(job.returnvalue as string));
        });
        console.log(`# flaky job ${finished} after ${attempts} attempts in ${Date.now() - started}ms`);

        const remaining = OBSERVE_MS - (Date.now() - started);
        if (remaining > 0) await sleep(remaining);
        await queue.removeJobScheduler('demo-tick');
        await worker.close();

        const completed = (await queue.getJobState(flaky.id!)) === 'completed' ? 1 : 0;

        checks.expect(policy === 'noeviction', `queue instance must not evict, got ${policy}`);
        checks.expect(attempts >= 3 && completed === 1, 'flaky job retried and completed');
        checks.expect(queued === 1, `jobId dedup left ${queued} jobs`);
        checks.expect(schedulers === 1, `upsert twice left ${schedulers} schedulers`);
        checks.expect(scheduledRuns >= 2, `scheduler fired ${scheduledRuns} times`);
        checks.expect(confirmations.size === 1, 'deduplicated job was processed once');

        checks.print({
            'queue-noeviction': policy === 'noeviction' ? 1 : 0,
            attempts,
            completed,
            added,
            queued,
            schedulers,
            'scheduled-runs': scheduledRuns,
        });
    } finally {
        await queue.obliterate({ force: true });
        await queue.close();
        connection.disconnect();
    }
    checks.finish();
});
