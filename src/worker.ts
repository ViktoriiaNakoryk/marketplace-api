import { createNotificationsQueue, createNotificationsWorker, ORDER_CONFIRMATION, REFRESH_PRODUCT_STATS, upsertSchedulers } from './queue/notifications.queue';
import { connectRedis, requiredEnv } from './redis/redis';

async function main() {
    const url = requiredEnv('REDIS_QUEUE_URL');
    const queueConnection = connectRedis(url);
    const queue = createNotificationsQueue(queueConnection);
    await upsertSchedulers(queue);

    const worker = createNotificationsWorker(url, {
        [ORDER_CONFIRMATION]: async (job) => console.log(`[worker] order confirmation email for order ${job.data.orderId}`),
        [REFRESH_PRODUCT_STATS]: async () => console.log('[worker] product stats refreshed'),
    });
    worker.on('failed', (job, err) => console.log(`[worker] ${job?.name} ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`));
    console.log('[worker] listening on queue notifications');

    const shutdown = async () => {
        await worker.close();
        await queue.close();
        queueConnection.disconnect();
        process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
