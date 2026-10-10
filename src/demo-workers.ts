import 'reflect-metadata';
import { AppDataSource } from './data-source';

const JOB_COUNT = 24;
const WORKER_COUNT = 3;
const JOB_DURATION_MS = 40;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function worker(workerId: string): Promise<number> {
    const qr = AppDataSource.createQueryRunner();
    await qr.connect();
    let handled = 0;

    try {
        while (true) {
            await qr.startTransaction();
            const rows: Array<{ id: string }> = await qr.query(
                `SELECT id FROM jobs WHERE status = 'pending' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`,
            );

            if (rows.length === 0) {
                await qr.commitTransaction();
                const [{ c }] = await qr.query(`SELECT count(*)::int AS c FROM jobs WHERE status = 'pending'`);
                if (Number(c) === 0) {
                    break;
                }
                await sleep(10);
                continue;
            }

            const id = rows[0].id;
            await sleep(JOB_DURATION_MS);
            await qr.query(
                `UPDATE jobs SET status = 'done', processed = processed + 1, worker = $1 WHERE id = $2`,
                [workerId, id],
            );
            await qr.commitTransaction();
            handled += 1;
        }
    } finally {
        await qr.release();
    }

    return handled;
}

async function main(): Promise<void> {
    await AppDataSource.initialize();

    await AppDataSource.query(`TRUNCATE TABLE jobs RESTART IDENTITY`);
    await AppDataSource.query(
        `INSERT INTO jobs (type, payload, status) SELECT 'demo', jsonb_build_object('n', g), 'pending' FROM generate_series(1, $1) AS g`,
        [JOB_COUNT],
    );

    const started = Date.now();
    const handledPerWorker = await Promise.all(
        Array.from({ length: WORKER_COUNT }, (_, i) => worker(`w${i + 1}`)),
    );
    const elapsed = Date.now() - started;

    const distribution: Array<{ worker: string; count: string }> = await AppDataSource.query(
        `SELECT worker, count(*)::text AS count FROM jobs GROUP BY worker ORDER BY worker`,
    );
    const [{ twice }] = await AppDataSource.query(`SELECT count(*)::int AS twice FROM jobs WHERE processed > 1`);
    const [{ done }] = await AppDataSource.query(`SELECT count(*)::int AS done FROM jobs WHERE status = 'done'`);

    const sequential = JOB_COUNT * JOB_DURATION_MS;

    console.log(`Задач:            ${JOB_COUNT}`);
    console.log(`Воркерів:         ${WORKER_COUNT}`);
    console.log('Розподіл по воркерах:');
    for (let i = 0; i < handledPerWorker.length; i += 1) {
        console.log(`  w${i + 1}: ${handledPerWorker[i]}`);
    }
    console.log(`  (з БД): ${distribution.map((d) => `${d.worker}=${d.count}`).join(', ')}`);
    console.log(`Оброблено:        ${done}/${JOB_COUNT}`);
    console.log(`Оброблено двічі:  ${twice}`);
    console.log(`Час паралельно:   ${elapsed} ms`);
    console.log(`Час послідовно (${JOB_COUNT} × ${JOB_DURATION_MS}ms): ${sequential} ms`);

    const ok = Number(twice) === 0 && Number(done) === JOB_COUNT && elapsed < sequential;
    console.log('');
    console.log(ok ? '✅ Кожна задача рівно раз, паралельно швидше за послідовно.' : '❌ Порушено інваріант воркерів.');

    await AppDataSource.destroy();
    process.exit(ok ? 0 : 1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
