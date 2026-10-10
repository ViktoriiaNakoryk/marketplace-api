import type { Pool } from 'pg';
import type { OrderPlacedEvent } from '../messaging/order-placed.event';

export const FULFILLMENT_CONSUMER = 'fulfillment';

export type EffectResult = { applied: boolean; duplicate: boolean };

export async function applyOrderPlaced(pool: Pool, event: OrderPlacedEvent): Promise<EffectResult> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const marked = await client.query(
            `INSERT INTO processed_messages (message_id, consumer) VALUES ($1, $2)
             ON CONFLICT DO NOTHING
             RETURNING message_id`,
            [event.eventId, FULFILLMENT_CONSUMER],
        );
        if (marked.rowCount === 0) {
            await client.query('ROLLBACK');
            return { applied: false, duplicate: true };
        }

        const inserted = await client.query(
            `INSERT INTO fulfillments ("eventId", "orderId", status)
             VALUES ($1, $2, 'queued')
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [event.eventId, event.data.orderId],
        );

        await client.query('COMMIT');
        return { applied: inserted.rowCount === 1, duplicate: false };
    } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
    } finally {
        client.release();
    }
}
