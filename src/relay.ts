import { writeSync } from 'node:fs';
import { Pool } from 'pg';
import { AmqpEventPublisher } from './messaging/event-publisher';
import { DEFAULT_RELAY_BATCH, relayBatch, type RelayReport } from './outbox/outbox-relay';

async function main() {
    const brokerUrl = process.env.BROKER_URL;
    const dbUrl = process.env.DATABASE_URL ?? process.env.DB_URL;
    if (!brokerUrl || !dbUrl) throw new Error('BROKER_URL and DATABASE_URL must be set');

    const json = process.env.RELAY_REPORT === 'json';
    const report: RelayReport = (line) =>
        writeSync(1, json ? `${JSON.stringify(line)}\n` : `[relay] ${line.kind} ${JSON.stringify({ ...line, kind: undefined })}\n`);

    const pool = new Pool({ connectionString: dbUrl, max: 2 });
    const publisher = new AmqpEventPublisher(brokerUrl);
    const batchSize = Number(process.env.RELAY_BATCH ?? DEFAULT_RELAY_BATCH);
    const pollMs = Number(process.env.RELAY_POLL_MS ?? 500);
    const crashAfterPublish = process.env.DEMO_CRASH_AFTER_PUBLISH === '1';

    let running = true;
    const shutdown = () => {
        running = false;
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);

    report({ kind: 'ready', batchSize, pollMs });
    while (running) {
        try {
            const published = await relayBatch(pool, publisher, {
                batchSize,
                report,
                afterPublish: crashAfterPublish ? () => void process.kill(process.pid, 'SIGKILL') : undefined,
            });
            if (published === batchSize) continue;
        } catch (e) {
            report({ kind: 'error', error: (e as Error).message });
        }
        await new Promise((r) => setTimeout(r, pollMs));
    }

    await publisher.close();
    await pool.end();
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
