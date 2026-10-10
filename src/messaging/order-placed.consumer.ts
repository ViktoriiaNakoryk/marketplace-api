import { connect, type ConsumeMessage } from 'amqplib';
import type { Pool } from 'pg';
import { applyOrderPlaced } from '../fulfillment/fulfillments.repository';
import { InvalidEventError, type OrderPlacedEvent, parseOrderPlaced } from './order-placed.event';
import { assertTopology, FULFILLMENT_QUEUE } from './topology';

export const DEFAULT_PREFETCH = 20;

export type ConsumerReport = (line: { kind: string } & Record<string, unknown>) => void;

export type ConsumerOptions = {
    brokerUrl: string;
    db: Pool;
    prefetch?: number;
    report?: ConsumerReport;
    beforeAck?: (event: OrderPlacedEvent) => void;
    onBrokerLost?: (reason: string) => void;
};

const isPermanentDbError = (e: unknown) => /^23/.test(String((e as { code?: string }).code ?? ''));

export async function startOrderPlacedConsumer(opts: ConsumerOptions): Promise<{ stop(): Promise<void> }> {
    const prefetch = opts.prefetch ?? DEFAULT_PREFETCH;
    const report: ConsumerReport = opts.report ?? (() => undefined);
    let stopping = false;

    const connection = await connect(opts.brokerUrl);
    connection.on('error', () => undefined);
    connection.on('close', () => {
        if (!stopping) opts.onBrokerLost?.('connection closed');
    });

    const channel = await connection.createChannel();
    await assertTopology(channel);
    await channel.prefetch(prefetch);

    const handle = async (msg: ConsumeMessage | null) => {
        if (!msg) {
            report({ kind: 'cancelled' });
            opts.onBrokerLost?.('consumer cancelled by broker');
            return;
        }

        const deliveryCount = Number(msg.properties.headers?.['x-delivery-count'] ?? 0);
        report({
            kind: 'delivery',
            messageId: msg.properties.messageId,
            redelivered: msg.fields.redelivered,
            deliveryCount,
        });

        let event: OrderPlacedEvent;
        try {
            event = parseOrderPlaced(msg.content);
        } catch (e) {
            report({ kind: 'reject', requeue: false, reason: (e as Error).message });
            channel.reject(msg, false);
            return;
        }

        const started = performance.now();
        let applied: boolean;
        let duplicate: boolean;
        try {
            ({ applied, duplicate } = await applyOrderPlaced(opts.db, event));
        } catch (e) {
            const permanent = e instanceof InvalidEventError || isPermanentDbError(e);
            report({ kind: 'reject', requeue: !permanent, reason: (e as Error).message });
            channel.reject(msg, !permanent);
            return;
        }
        report({
            kind: 'effect',
            eventId: event.eventId,
            applied,
            duplicate,
            ms: +(performance.now() - started).toFixed(2),
        });

        opts.beforeAck?.(event);
        channel.ack(msg);
        report({ kind: 'ack', eventId: event.eventId });
    };

    const { consumerTag } = await channel.consume(FULFILLMENT_QUEUE, (msg) => void handle(msg), { noAck: false });
    report({ kind: 'ready', queue: FULFILLMENT_QUEUE, prefetch });

    return {
        async stop() {
            stopping = true;
            await channel.cancel(consumerTag).catch(() => undefined);
            await channel.close().catch(() => undefined);
            await connection.close().catch(() => undefined);
        },
    };
}
