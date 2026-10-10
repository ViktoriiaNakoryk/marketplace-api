import type { Pool } from 'pg';
import type { EventPublisher, PublishedEvent } from '../messaging/event-publisher';

export const DEFAULT_RELAY_BATCH = 50;

export type RelayReport = (line: { kind: string } & Record<string, unknown>) => void;

export type RelayOptions = {
    batchSize?: number;
    report?: RelayReport;
    afterPublish?: (id: string) => void | Promise<void>;
};

export async function relayBatch(pool: Pool, publisher: EventPublisher, opts: RelayOptions = {}): Promise<number> {
    const report = opts.report ?? (() => undefined);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query<{ id: string; type: string; payload: PublishedEvent }>(
            `SELECT id, type, payload
             FROM outbox
             WHERE published_at IS NULL
             ORDER BY created_at, id
             FOR UPDATE SKIP LOCKED
             LIMIT $1`,
            [opts.batchSize ?? DEFAULT_RELAY_BATCH],
        );

        let published = 0;
        for (const row of rows) {
            try {
                await publisher.publish(row.type, row.payload);
            } catch (e) {
                report({ kind: 'publish-failed', id: row.id, error: (e as Error).message });
                await client.query(`UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1`, [
                    row.id,
                    (e as Error).message,
                ]);
                continue;
            }
            report({ kind: 'published', id: row.id, type: row.type });
            await opts.afterPublish?.(row.id);

            await client.query(
                `UPDATE outbox SET published_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1`,
                [row.id],
            );
            published++;
        }

        await client.query('COMMIT');
        if (published) report({ kind: 'committed', published });
        return published;
    } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
    } finally {
        client.release();
    }
}
