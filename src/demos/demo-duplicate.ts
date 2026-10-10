import { run, Demo } from './harness';
import { FULFILLMENT_DLQ, FULFILLMENT_QUEUE } from '../messaging/topology';

run(async () => {
    const demo = await Demo.start('demo:duplicate');
    const { buyer, product } = await demo.givenCatalogue();

    const crashing = demo.spawnConsumer({ DEMO_CRASH_BEFORE_ACK: '1' });
    await crashing.waitFor(() => crashing.prefetch > 0, 'crashing consumer ready');

    const order = await demo.ordersService().placeOrder({ buyerId: buyer.id, items: [{ productId: product.id, quantity: 1 }] });
    const eventId = `order.placed:${order!.id}`;

    const crash = await crashing.exited;
    console.log(`# consumer #1 applied the effect and died before ack (signal ${crash.signal})`);

    const healthy = demo.spawnConsumer();
    await healthy.waitFor(() => healthy.count('ack') >= 1, 'redelivery acked');
    await healthy.stop();

    const lines = [...crashing.lines, ...healthy.lines];
    const count = (kind: string, where: (l: any) => boolean = () => true) =>
        lines.filter((l) => l.kind === kind && where(l)).length;
    const redelivery = healthy.lines.find((l) => l.kind === 'delivery');

    const summary = {
        deliveries: count('delivery'),
        effect: count('effect', (l) => l.applied),
        skipped: count('effect', (l) => !l.applied),
        acked: count('ack'),
        redelivered: redelivery?.redelivered ? 1 : 0,
        'fulfillment-rows': await demo.fulfillmentsFor([order!.id]),
        work: await demo.depth(FULFILLMENT_QUEUE, 0),
        dlq: await demo.depth(FULFILLMENT_DLQ, 0),
    };
    console.log(`# eventId=${eventId}`);
    demo.print(summary);

    demo.expect(crash.signal === 'SIGKILL', `consumer #1 exited with ${crash.signal ?? crash.code}, expected SIGKILL`);
    demo.expect(summary.deliveries >= 2, `deliveries=${summary.deliveries}, expected >= 2`);
    demo.expect(summary.effect === 1, `effect=${summary.effect}, expected 1`);
    demo.expect(summary['fulfillment-rows'] === 1, `fulfillment rows=${summary['fulfillment-rows']}, expected 1`);
    demo.expect(summary.skipped === summary.deliveries - 1, `skipped=${summary.skipped}, expected ${summary.deliveries - 1}`);
    demo.expect(summary.work === 0 && summary.dlq === 0, `work=${summary.work} dlq=${summary.dlq}, expected 0/0`);
    await demo.finish();
});
