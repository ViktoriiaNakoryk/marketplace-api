import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { run, Demo } from './harness';

const REQUESTS = 2;

async function startApi(): Promise<INestApplication> {
    process.env.DB_URL = process.env.DATABASE_URL;
    const { AppModule } = await import('../app.module.js');
    const { configureApp } = await import('../app.setup.js');
    const app = configureApp(await NestFactory.create(AppModule, { logger: ['error', 'warn'] }));
    await app.listen(0, '127.0.0.1');
    return app;
}

run(async () => {
    const demo = await Demo.start('demo:outbox');
    const consumer = demo.spawnConsumer();
    await consumer.waitFor(() => consumer.prefetch > 0, 'consumer ready');
    const api = await startApi();
    const baseUrl = await api.getUrl();

    const { buyer, product } = await demo.givenCatalogue();
    const key = randomUUID();
    const body = JSON.stringify({ buyerId: buyer.id, items: [{ productId: product.id, quantity: 2 }] });

    const responses = await Promise.all(
        Array.from({ length: REQUESTS }, () =>
            fetch(`${baseUrl}/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
                body,
            }),
        ),
    );
    const bodies = await Promise.all(responses.map((r) => r.json()));
    const orderIds = [...new Set(bodies.map((b) => b.id as number))];
    console.log(
        `# ${REQUESTS} concurrent POST /orders with Idempotency-Key ${key}: ` +
            responses.map((r) => `${r.status}${r.headers.get('idempotent-replayed') ? ' (replayed)' : ''}`).join(', ') +
            ` → order id(s) ${orderIds.join(', ')}`,
    );

    const outboxBeforeRelay = await demo.outboxFor(orderIds, false);
    const published = await demo.relayAll();
    await consumer.waitFor(() => consumer.count('ack') >= 1, 'consumer ack');
    await new Promise((r) => setTimeout(r, 500));
    await consumer.stop();
    await api.close();

    const eventId = await demo.eventIdOf(orderIds[0]);
    const summary = {
        requests: responses.length,
        created: responses.filter((r) => r.status === 201).length,
        replayed: responses.filter((r) => r.headers.get('idempotent-replayed') === 'true').length,
        orders: await demo.ordersOf(buyer.id),
        outbox: await demo.outboxFor(orderIds),
        'outbox-pending-before-relay': outboxBeforeRelay,
        published,
        deliveries: consumer.count('delivery'),
        effect: consumer.count('effect', (l) => l.applied),
        processed: await demo.processedFor([eventId]),
        'fulfillment-rows': await demo.fulfillmentsFor(orderIds),
    };
    demo.print(summary);

    demo.expect(summary.created === REQUESTS, `created=${summary.created}, every request must get 201`);
    demo.expect(summary.replayed === REQUESTS - 1, `replayed=${summary.replayed}, expected ${REQUESTS - 1}`);
    demo.expect(orderIds.length === 1, `responses point at ${orderIds.length} different orders`);
    for (const [k, v] of [['orders', 1], ['outbox', 1], ['published', 1], ['deliveries', 1], ['effect', 1], ['processed', 1], ['fulfillment-rows', 1]] as const) {
        demo.expect(summary[k] === v, `${k}=${summary[k]}, expected ${v}`);
    }
    await demo.finish();
});
