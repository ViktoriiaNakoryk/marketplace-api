import type { Queryable } from '../database/queryable';
import type { OrderPlacedEvent } from '../messaging/order-placed.event';

export async function applyOrderPlaced(db: Queryable, event: OrderPlacedEvent): Promise<boolean> {
    const { rows } = await db.query(
        `INSERT INTO fulfillments ("eventId", "orderId", status)
         VALUES ($1, $2, 'queued')
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [event.eventId, event.data.orderId],
    );
    return rows.length === 1;
}
