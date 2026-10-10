import type { Queryable } from '../database/queryable';

export type OutboxMessage = {
    id: string;
    aggregatetype: string;
    aggregateid: string;
    type: string;
    payload: unknown;
};

export async function appendToOutbox(db: Queryable, message: OutboxMessage): Promise<void> {
    await db.query(
        `INSERT INTO outbox (id, aggregatetype, aggregateid, type, payload) VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [message.id, message.aggregatetype, message.aggregateid, message.type, JSON.stringify(message.payload)],
    );
}
