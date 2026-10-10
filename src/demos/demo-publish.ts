import { run, Demo } from './harness';
import { randomUUID } from 'node:crypto';
import { FULFILLMENT_DLQ, FULFILLMENT_QUEUE } from '../messaging/topology';

const EVENTS = 5;

run(async () => {
    const demo = await Demo.start('demo:publish');
    const consumer = demo.spawnConsumer();
    await consumer.waitFor(() => consumer.prefetch > 0, 'consumer ready');

    const { buyer, product } = await demo.givenCatalogue();
    const orders = demo.ordersService();
    const orderIds: number[] = [];
    for (let i = 0; i < EVENTS; i++) {
        const placed = await orders.placeOrder(
            { buyerId: buyer.id, items: [{ productId: product.id, quantity: 1 }] },
            randomUUID(),
        );
        orderIds.push(placed!.order.id);
    }
    const published = await demo.relayAll();

    await consumer.waitFor(() => consumer.count('ack') >= EVENTS, `${EVENTS} acks`);
    await consumer.stop();

    const effects = consumer.lines.filter((l) => l.kind === 'effect');
    const avgMs = effects.reduce((s, l) => s + l.ms, 0) / Math.max(effects.length, 1);
    const rows = await demo.fulfillmentsFor(orderIds);

    const summary = {
        published,
        delivered: consumer.count('delivery'),
        effect: consumer.count('effect', (l) => l.applied),
        acked: consumer.count('ack'),
        work: await demo.depth(FULFILLMENT_QUEUE, 0),
        dlq: await demo.depth(FULFILLMENT_DLQ, 0),
        prefetch: consumer.prefetch,
        'fulfillment-rows': rows,
        'effect-avg-ms': avgMs.toFixed(2),
    };
    demo.print(summary);

    demo.expect(summary.published === EVENTS, `published=${summary.published}, expected ${EVENTS}`);
    demo.expect(summary.delivered === EVENTS, `delivered=${summary.delivered}, expected ${EVENTS}`);
    demo.expect(summary.effect === EVENTS, `effect=${summary.effect}, expected ${EVENTS}`);
    demo.expect(summary.acked === EVENTS, `acked=${summary.acked}, expected ${EVENTS}`);
    demo.expect(rows === EVENTS, `fulfillment rows=${rows}, expected ${EVENTS}`);
    demo.expect(summary.work === 0 && summary.dlq === 0, `work=${summary.work} dlq=${summary.dlq}, expected 0/0`);
    demo.expect(summary.prefetch >= 1 && summary.prefetch <= 2000, `prefetch=${summary.prefetch} outside 1..2000`);
    await demo.finish();
});
