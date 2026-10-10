import type { Channel } from 'amqplib';

export const EXCHANGE = 'shop.events';
export const UNROUTED_EXCHANGE = 'shop.events.unrouted';
export const UNROUTED_QUEUE = 'shop.events.unrouted';
export const DEAD_LETTER_EXCHANGE = 'shop.events.dlx';

export const ORDER_PLACED = 'order.placed';
export const FULFILLMENT_QUEUE = 'fulfillment.order-placed';
export const FULFILLMENT_DLQ = 'fulfillment.order-placed.dlq';
export const DELIVERY_LIMIT = 5;

const QUORUM = { 'x-queue-type': 'quorum' };

export async function assertTopology(ch: Channel): Promise<void> {
    await ch.assertExchange(UNROUTED_EXCHANGE, 'fanout', { durable: true });
    await ch.assertQueue(UNROUTED_QUEUE, { durable: true, arguments: QUORUM });
    await ch.bindQueue(UNROUTED_QUEUE, UNROUTED_EXCHANGE, '');

    await ch.assertExchange(EXCHANGE, 'topic', { durable: true, alternateExchange: UNROUTED_EXCHANGE });

    await ch.assertExchange(DEAD_LETTER_EXCHANGE, 'topic', { durable: true });
    await ch.assertQueue(FULFILLMENT_DLQ, { durable: true, arguments: QUORUM });
    await ch.bindQueue(FULFILLMENT_DLQ, DEAD_LETTER_EXCHANGE, ORDER_PLACED);

    await ch.assertQueue(FULFILLMENT_QUEUE, {
        durable: true,
        arguments: {
            ...QUORUM,
            'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE,
            'x-dead-letter-routing-key': ORDER_PLACED,
            'x-delivery-limit': DELIVERY_LIMIT,
        },
    });
    await ch.bindQueue(FULFILLMENT_QUEUE, EXCHANGE, ORDER_PLACED);
}
