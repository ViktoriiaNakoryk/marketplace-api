import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database/database.module';
import { toOrderPlacedEvent } from '../messaging/order-placed.event';
import { ORDER_PLACED } from '../messaging/topology';
import { appendToOutbox } from '../outbox/outbox.repository';
import { OrderEventsService, OrderStatusEvent } from './order-events.service';
import { NewOrder, OrderStatus, OrdersRepository, OrderView } from './orders.repository';

export type PlaceOrderResult = { order: OrderView; replayed: boolean } | null;

export type PlaceOrderFaults = {
    afterOutboxWrite?: (client: PoolClient) => Promise<void>;
};

function fingerprint(input: NewOrder): string {
    const canonical = JSON.stringify({
        buyerId: input.buyerId,
        items: input.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    });
    return createHash('sha256').update(canonical).digest('hex');
}

@Injectable()
export class OrdersService {
    constructor(
        private readonly orders: OrdersRepository,
        private readonly events: OrderEventsService,
        @Inject(PG_POOL) private readonly pool: Pool,
    ) {}

    async placeOrder(input: NewOrder, idempotencyKey: string, faults: PlaceOrderFaults = {}): Promise<PlaceOrderResult> {
        const requestFingerprint = fingerprint(input);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            const claimed = await client.query(
                `INSERT INTO idempotency_keys (key, request_fingerprint) VALUES ($1, $2)
                 ON CONFLICT (key) DO NOTHING
                 RETURNING key`,
                [idempotencyKey, requestFingerprint],
            );
            if (claimed.rowCount === 0) {
                await client.query('ROLLBACK');
                return this.replay(idempotencyKey, requestFingerprint);
            }

            const order = await new OrdersRepository(client).create(input);
            if (!order) {
                await client.query('ROLLBACK');
                return null;
            }

            await client.query(`UPDATE idempotency_keys SET order_id = $2 WHERE key = $1`, [idempotencyKey, order.id]);

            const eventId = randomUUID();
            await appendToOutbox(client, {
                id: eventId,
                aggregatetype: 'order',
                aggregateid: String(order.id),
                type: ORDER_PLACED,
                payload: toOrderPlacedEvent(order, eventId),
            });

            await faults.afterOutboxWrite?.(client);

            await client.query('COMMIT');
            return { order, replayed: false };
        } catch (e) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw e;
        } finally {
            client.release();
        }
    }

    async changeStatus(orderId: number, status: OrderStatus): Promise<OrderStatusEvent> {
        const change = await this.orders.updateStatus(orderId, status);
        if (!change) throw new NotFoundException(`Order ${orderId} not found`);
        return this.events.publish(change);
    }

    private async replay(key: string, requestFingerprint: string): Promise<PlaceOrderResult> {
        const { rows } = await this.pool.query(
            `SELECT request_fingerprint, order_id FROM idempotency_keys WHERE key = $1`,
            [key],
        );
        if (rows[0].request_fingerprint !== requestFingerprint) {
            throw new UnprocessableEntityException(`Idempotency-Key ${key} was already used with a different request`);
        }
        const order = await this.orders.findById(Number(rows[0].order_id));
        return order ? { order, replayed: true } : null;
    }
}
