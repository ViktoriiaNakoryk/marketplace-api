import 'reflect-metadata';
import { AppDataSource } from './data-source';

const USER_ID = 1;
const INITIAL = 1000;
const INCREMENT = 100;
const CONCURRENCY = 2;
const MAX_RETRIES = 5;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let retriesCaught = 0;

function pgCode(error: unknown): string | undefined {
    const e = error as { code?: string; driverError?: { code?: string } };
    return e?.code ?? e?.driverError?.code;
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    while (true) {
        try {
            return await fn();
        } catch (error) {
            const code = pgCode(error);
            if ((code === '40001' || code === '40P01') && attempt < MAX_RETRIES) {
                attempt += 1;
                retriesCaught += 1;
                const backoff = Math.round(20 * attempt + Math.random() * 20);
                console.log(`[${label}] спіймано ${code} (serialization failure) — повтор #${attempt} через ${backoff}ms`);
                await sleep(backoff);
                continue;
            }
            throw error;
        }
    }
}

function makeBarrier(n: number): () => Promise<void> {
    let count = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    return () => {
        count += 1;
        if (count >= n) {
            release();
        }
        return gate;
    };
}

async function increment(label: string, barrier: () => Promise<void>): Promise<void> {
    await withRetry(label, async () => {
        const qr = AppDataSource.createQueryRunner();
        await qr.connect();
        try {
            await qr.startTransaction('REPEATABLE READ');
            const [{ balance }] = await qr.query(`SELECT balance FROM users WHERE id = $1`, [USER_ID]);
            const next = Number(balance) + INCREMENT;
            await barrier();
            await qr.query(`UPDATE users SET balance = $1 WHERE id = $2`, [next, USER_ID]);
            await qr.commitTransaction();
        } catch (error) {
            await qr.rollbackTransaction().catch(() => undefined);
            throw error;
        } finally {
            await qr.release();
        }
    });
}

async function main(): Promise<void> {
    await AppDataSource.initialize();

    await AppDataSource.query(`UPDATE users SET balance = $1 WHERE id = $2`, [INITIAL, USER_ID]);

    const barrier = makeBarrier(CONCURRENCY);
    await Promise.all(
        Array.from({ length: CONCURRENCY }, (_, i) => increment(`tx${i + 1}`, barrier)),
    );

    const [{ balance }] = await AppDataSource.query(`SELECT balance FROM users WHERE id = $1`, [USER_ID]);
    const expected = INITIAL + CONCURRENCY * INCREMENT;

    console.log('');
    console.log(`Паралельних read-modify-write: ${CONCURRENCY}`);
    console.log(`Спіймано serialization failures з повтором: ${retriesCaught}`);
    console.log(`Фінальний balance: ${balance} (очікувано ${expected})`);

    const ok = Number(balance) === expected && retriesCaught >= 1;
    console.log('');
    console.log(ok ? '✅ Retry спрацював, стан арифметично коректний.' : '❌ Стан не зійшовся або конфлікту не було.');

    await AppDataSource.destroy();
    process.exit(ok ? 0 : 1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
