import { run, Demo } from './harness';
import { FULFILLMENT_DLQ, FULFILLMENT_QUEUE, ORDER_PLACED } from '../messaging/topology';

const DEAD_LETTER_REASONS = ['rejected', 'expired', 'maxlen', 'delivery_limit'];

run(async () => {
    const demo = await Demo.start('demo:dlq');
    const consumer = demo.spawnConsumer();
    await consumer.waitFor(() => consumer.prefetch > 0, 'consumer ready');

    const messageId = `poison-${Date.now()}`;
    const poison = { eventId: messageId, type: 'order.placed', version: 1, data: { orderId: 'not-a-number' } };
    await demo.publisher.publishRaw(ORDER_PLACED, Buffer.from(JSON.stringify(poison)), { messageId, type: 'order.placed' });
    console.log(`# published poison message ${messageId}: data.orderId is not a number`);

    await consumer.waitFor(() => consumer.count('reject') >= 1, 'poison rejected');
    await consumer.stop();

    const dlq = await demo.depth(FULFILLMENT_DLQ, 1);
    const dead = await demo.channel.get(FULFILLMENT_DLQ, { noAck: false });
    const headers = dead ? (dead.properties.headers ?? {}) : {};
    const xDeath = (headers['x-death'] as { reason: string; queue: string; count: number }[] | undefined)?.[0];
    const reason = String(headers['x-first-death-reason'] ?? xDeath?.reason ?? 'none');
    if (dead) demo.channel.nack(dead, false, true);

    const summary = {
        rejected: consumer.count('reject', (l) => l.requeue === false),
        effect: consumer.count('effect', (l) => l.applied),
        work: await demo.depth(FULFILLMENT_QUEUE, 0),
        dlq: await demo.depth(FULFILLMENT_DLQ, 1),
        'dlq-reason': reason,
        'dlq-from-queue': String(headers['x-first-death-queue'] ?? xDeath?.queue ?? 'none'),
        'dlq-message-id': dead ? dead.properties.messageId : 'none',
    };
    const why = consumer.lines.find((l) => l.kind === 'reject')?.reason;
    console.log(`# consumer reject reason: ${why}`);
    demo.print(summary);

    demo.expect(dlq === 1 && summary.dlq === 1, `dlq=${summary.dlq}, expected 1`);
    demo.expect(summary.work === 0, `work=${summary.work}, expected 0`);
    demo.expect(summary.effect === 0, `effect=${summary.effect}, expected 0`);
    demo.expect(DEAD_LETTER_REASONS.includes(reason), `dlq-reason=${reason} is not a dead-letter reason`);
    demo.expect(summary['dlq-message-id'] === messageId, `DLQ holds ${summary['dlq-message-id']}, expected ${messageId}`);
    await demo.finish();
});
