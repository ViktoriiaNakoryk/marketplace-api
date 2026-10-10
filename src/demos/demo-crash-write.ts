import { randomUUID } from 'node:crypto';
import { run, Demo } from './harness';

run(async () => {
    const demo = await Demo.start('demo:crash-write');
    const consumer = demo.spawnConsumer();
    await consumer.waitFor(() => consumer.prefetch > 0, 'consumer ready');

    const { buyer, product } = await demo.givenCatalogue();
    const key = randomUUID();
    let outboxInsideTx = 0;
    let writeFailed = 0;
    try {
        await demo.ordersService().placeOrder(
            { buyerId: buyer.id, items: [{ productId: product.id, quantity: 1 }] },
            key,
            {
                afterOutboxWrite: async (client) => {
                    const { rows } = await client.query(
                        `SELECT count(*)::int AS n FROM outbox WHERE payload->'data'->>'buyerId' = $1`,
                        [String(buyer.id)],
                    );
                    outboxInsideTx = rows[0].n;
                    throw new Error('simulated crash: business transaction dies after the outbox INSERT, before COMMIT');
                },
            },
        );
    } catch (e) {
        writeFailed = 1;
        console.log(`# placeOrder failed: ${(e as Error).message}`);
    }

    const published = await demo.relayAll();
    await new Promise((r) => setTimeout(r, 1000));
    await consumer.stop();

    const summary = {
        'write-failed': writeFailed,
        'outbox-inside-tx': outboxInsideTx,
        orders: await demo.ordersOf(buyer.id),
        outbox: await demo.scalar(`SELECT count(*)::int AS n FROM outbox WHERE payload->'data'->>'buyerId' = $1`, [String(buyer.id)]),
        'idempotency-keys': await demo.scalar(`SELECT count(*)::int AS n FROM idempotency_keys WHERE key = $1`, [key]),
        published,
        deliveries: consumer.count('delivery'),
        effect: consumer.count('effect', (l) => l.applied),
    };
    demo.print(summary);

    demo.expect(summary['write-failed'] === 1, 'business write did not fail');
    demo.expect(summary['outbox-inside-tx'] === 1, `outbox row was not written before the crash (saw ${outboxInsideTx})`);
    for (const k of ['orders', 'outbox', 'idempotency-keys', 'published', 'deliveries', 'effect'] as const) {
        demo.expect(summary[k] === 0, `${k}=${summary[k]}, expected 0`);
    }
    await demo.finish();
});
