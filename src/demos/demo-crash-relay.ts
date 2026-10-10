import { randomUUID } from 'node:crypto';
import { run, Demo } from './harness';
import { FULFILLMENT_DLQ, FULFILLMENT_QUEUE } from '../messaging/topology';

run(async () => {
    const demo = await Demo.start('demo:crash-relay');
    const consumer = demo.spawnConsumer();
    await consumer.waitFor(() => consumer.prefetch > 0, 'consumer ready');

    const { buyer, product } = await demo.givenCatalogue();
    const placed = await demo.ordersService().placeOrder(
        { buyerId: buyer.id, items: [{ productId: product.id, quantity: 1 }] },
        randomUUID(),
    );
    const orderId = placed!.order.id;
    const eventId = await demo.eventIdOf(orderId);
    console.log(`# order ${orderId} committed together with outbox event ${eventId}`);

    const crashing = demo.spawnRelay({ DEMO_CRASH_AFTER_PUBLISH: '1' });
    const crash = await crashing.exited;
    const pendingAfterCrash = await demo.outboxFor([orderId], false);
    console.log(`# relay #1 published and died before UPDATE published_at (signal ${crash.signal}); outbox row still pending: ${pendingAfterCrash}`);

    await consumer.waitFor(() => consumer.count('ack') >= 1, 'first delivery acked');

    const relay = demo.spawnRelay();
    await relay.waitFor(() => relay.count('committed') >= 1, 'relay #2 committed');
    await relay.stop();
    await consumer.waitFor(() => consumer.count('ack') >= 2, 'second delivery acked');
    await consumer.stop();

    const summary = {
        published: crashing.count('published') + relay.count('published'),
        deliveries: consumer.count('delivery'),
        applied: consumer.count('effect', (l) => l.applied),
        duplicates: consumer.count('effect', (l) => l.duplicate),
        effect: await demo.fulfillmentsFor([orderId]),
        processed: await demo.processedFor([eventId]),
        'outbox-pending': await demo.outboxFor([orderId], false),
        work: await demo.depth(FULFILLMENT_QUEUE, 0),
        dlq: await demo.depth(FULFILLMENT_DLQ, 0),
    };
    demo.print(summary);

    demo.expect(crash.signal === 'SIGKILL', `relay #1 exited with ${crash.signal ?? crash.code}, expected SIGKILL`);
    demo.expect(pendingAfterCrash === 1, `outbox row was marked published despite the crash (${pendingAfterCrash})`);
    demo.expect(summary.published >= 2, `published=${summary.published}, expected >= 2`);
    demo.expect(summary.deliveries >= 2, `deliveries=${summary.deliveries}, expected >= 2`);
    demo.expect(summary.applied === 1, `applied=${summary.applied}, expected 1`);
    demo.expect(summary.effect === 1, `effect=${summary.effect}, expected 1`);
    demo.expect(summary.processed === 1, `processed=${summary.processed}, expected 1`);
    demo.expect(summary['outbox-pending'] === 0, `outbox-pending=${summary['outbox-pending']}, expected 0`);
    demo.expect(summary.work === 0 && summary.dlq === 0, `work=${summary.work} dlq=${summary.dlq}, expected 0/0`);
    await demo.finish();
});
