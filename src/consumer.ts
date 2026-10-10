import { writeSync } from 'node:fs';
import { Pool } from 'pg';
import { DEFAULT_PREFETCH, startOrderPlacedConsumer, type ConsumerReport } from './messaging/order-placed.consumer';

async function main() {
    const brokerUrl = process.env.BROKER_URL;
    const dbUrl = process.env.DATABASE_URL ?? process.env.DB_URL;
    if (!brokerUrl || !dbUrl) throw new Error('BROKER_URL and DATABASE_URL must be set');

    const json = process.env.CONSUMER_REPORT === 'json';
    const report: ConsumerReport = (line) =>
        writeSync(1, json ? `${JSON.stringify(line)}\n` : `[consumer] ${line.kind} ${JSON.stringify({ ...line, kind: undefined })}\n`);

    const pool = new Pool({ connectionString: dbUrl, max: 5 });
    const consumer = await startOrderPlacedConsumer({
        brokerUrl,
        db: pool,
        prefetch: Number(process.env.CONSUMER_PREFETCH ?? DEFAULT_PREFETCH),
        report,
        beforeAck: process.env.DEMO_CRASH_BEFORE_ACK === '1' ? () => process.kill(process.pid, 'SIGKILL') : undefined,
        onBrokerLost: (reason) => {
            report({ kind: 'fatal', reason });
            process.exit(1);
        },
    });

    const shutdown = async () => {
        await consumer.stop();
        await pool.end();
        process.exit(0);
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
