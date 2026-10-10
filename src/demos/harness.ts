import 'reflect-metadata';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { connect, type Channel, type ChannelModel } from 'amqplib';
import { Pool } from 'pg';
import { AppDataSource } from '../data-source';
import { AmqpEventPublisher } from '../messaging/event-publisher';
import { assertTopology, FULFILLMENT_DLQ, FULFILLMENT_QUEUE } from '../messaging/topology';
import { relayBatch } from '../outbox/outbox-relay';
import { OrderEventsService } from '../orders/order-events.service';
import { OrdersRepository } from '../orders/orders.repository';
import { OrdersService } from '../orders/orders.service';
import { ProductsRepository } from '../products/products.repository';
import { UsersRepository } from '../users/users.repository';

export type ConsumerLine = { kind: string } & Record<string, any>;

export class DemoChild {
    readonly lines: ConsumerLine[] = [];
    readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
    private waiters: (() => void)[] = [];

    constructor(private readonly child: ChildProcess) {
        let buffer = '';
        child.stdout!.setEncoding('utf8');
        child.stdout!.on('data', (chunk: string) => {
            buffer += chunk;
            let nl: number;
            while ((nl = buffer.indexOf('\n')) >= 0) {
                const raw = buffer.slice(0, nl).trim();
                buffer = buffer.slice(nl + 1);
                if (!raw) continue;
                try {
                    this.lines.push(JSON.parse(raw));
                } catch {
                    console.log(`[consumer] ${raw}`);
                }
                this.waiters.forEach((w) => w());
            }
        });
        this.exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
        this.exited.then(() => this.waiters.forEach((w) => w()));
    }

    count(kind: string, where: (l: ConsumerLine) => boolean = () => true): number {
        return this.lines.filter((l) => l.kind === kind && where(l)).length;
    }

    async waitFor(predicate: () => boolean, label: string, timeoutMs = 15_000): Promise<void> {
        if (predicate()) return;
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), timeoutMs);
            const check = () => {
                if (predicate()) {
                    clearTimeout(timer);
                    this.waiters = this.waiters.filter((w) => w !== check);
                    resolve();
                }
            };
            this.waiters.push(check);
        });
    }

    get prefetch(): number {
        return Number(this.lines.find((l) => l.kind === 'ready')?.prefetch ?? 0);
    }

    async stop(): Promise<void> {
        if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGTERM');
        await this.exited;
    }
}

export class Demo {
    private failures: string[] = [];

    private constructor(
        readonly name: string,
        readonly pool: Pool,
        readonly connection: ChannelModel,
        readonly channel: Channel,
        readonly publisher: AmqpEventPublisher,
    ) {}

    static async start(name: string): Promise<Demo> {
        const brokerUrl = required('BROKER_URL');
        process.env.DATABASE_URL ??= process.env.DB_URL;
        required('DATABASE_URL');

        await AppDataSource.initialize();
        await AppDataSource.runMigrations();
        await AppDataSource.destroy();

        const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
        const connection = await connect(brokerUrl);
        const channel = await connection.createChannel();
        await assertTopology(channel);

        const publisher = new AmqpEventPublisher(brokerUrl);
        let flushed = 0;
        for (let n = -1; n !== 0; flushed += n) n = await relayBatch(pool, publisher, { batchSize: 500 });

        const { consumerCount } = await channel.checkQueue(FULFILLMENT_QUEUE);
        if (consumerCount > 0) {
            throw new Error(`${FULFILLMENT_QUEUE} already has ${consumerCount} consumer(s) — stop npm run consumer first`);
        }
        await channel.purgeQueue(FULFILLMENT_QUEUE);
        await channel.purgeQueue(FULFILLMENT_DLQ);

        console.log(
            `# ${name}: topology asserted, outbox flushed (${flushed} stale), ${FULFILLMENT_QUEUE} and ${FULFILLMENT_DLQ} purged`,
        );
        return new Demo(name, pool, connection, channel, publisher);
    }

    spawnConsumer(env: Record<string, string> = {}): DemoChild {
        return this.spawnChild('consumer.js', { CONSUMER_REPORT: 'json', ...env });
    }

    spawnRelay(env: Record<string, string> = {}): DemoChild {
        return this.spawnChild('relay.js', { RELAY_REPORT: 'json', RELAY_POLL_MS: '100', ...env });
    }

    private spawnChild(script: string, env: Record<string, string>): DemoChild {
        const child = spawn(process.execPath, [join(__dirname, '..', script)], {
            env: { ...process.env, ...env },
            stdio: ['ignore', 'pipe', 'inherit'],
        });
        return new DemoChild(child);
    }

    ordersService(): OrdersService {
        return new OrdersService(new OrdersRepository(this.pool), new OrderEventsService(), this.pool);
    }

    async relayAll(): Promise<number> {
        let total = 0;
        for (let n = -1; n !== 0; total += n) n = await relayBatch(this.pool, this.publisher);
        return total;
    }

    async scalar(sql: string, params: unknown[] = []): Promise<number> {
        const { rows } = await this.pool.query(sql, params);
        return Number(rows[0]?.n ?? 0);
    }

    async outboxFor(orderIds: number[], published?: boolean): Promise<number> {
        const filter = published === undefined ? '' : published ? 'AND published_at IS NOT NULL' : 'AND published_at IS NULL';
        return this.scalar(
            `SELECT count(*)::int AS n FROM outbox WHERE aggregatetype = 'order' AND aggregateid = ANY($1::text[]) ${filter}`,
            [orderIds.map(String)],
        );
    }

    async eventIdOf(orderId: number): Promise<string> {
        const { rows } = await this.pool.query(
            `SELECT id FROM outbox WHERE aggregatetype = 'order' AND aggregateid = $1`,
            [String(orderId)],
        );
        return rows[0]?.id;
    }

    async processedFor(eventIds: string[]): Promise<number> {
        return this.scalar(`SELECT count(*)::int AS n FROM processed_messages WHERE message_id = ANY($1::text[])`, [eventIds]);
    }

    async ordersOf(buyerId: number): Promise<number> {
        return this.scalar(`SELECT count(*)::int AS n FROM orders WHERE "buyerId" = $1`, [buyerId]);
    }

    async givenCatalogue() {
        const tag = `${Date.now().toString(36)}-${process.pid}`;
        const users = new UsersRepository(this.pool);
        const seller = await users.create({ email: `demo-seller-${tag}@demo.local`, fullName: 'Demo Seller', role: 'seller', balance: 0 });
        const buyer = await users.create({ email: `demo-buyer-${tag}@demo.local`, fullName: 'Demo Buyer', role: 'buyer', balance: 1_000_000 });
        const product = await new ProductsRepository(this.pool).create({
            sellerId: seller.id,
            sku: `DEMO-${tag}`,
            name: 'Demo product',
            description: 'Product created by the RabbitMQ demo',
            category: 'Demo',
            brand: 'Demo',
            price: 9_900,
            stock: 100,
        });
        return { buyer, product };
    }

    async fulfillmentsFor(orderIds: number[]): Promise<number> {
        const { rows } = await this.pool.query('SELECT count(*)::int AS n FROM fulfillments WHERE "orderId" = ANY($1::bigint[])', [orderIds]);
        return rows[0].n;
    }

    async depth(queue: string, expected?: number, timeoutMs = 5_000): Promise<number> {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            const { messageCount } = await this.channel.checkQueue(queue);
            if (expected === undefined || messageCount === expected || Date.now() > deadline) return messageCount;
            await new Promise((r) => setTimeout(r, 200));
        }
    }

    print(summary: Record<string, string | number>): void {
        for (const [k, v] of Object.entries(summary)) console.log(`${k}=${v}`);
    }

    expect(condition: boolean, message: string): void {
        if (!condition) this.failures.push(message);
    }

    async finish(): Promise<never> {
        await this.publisher.close();
        await this.connection.close().catch(() => undefined);
        await this.pool.end();
        if (this.failures.length) {
            this.failures.forEach((f) => console.error(`INVARIANT VIOLATED: ${f}`));
            process.exit(1);
        }
        console.log(`# ${this.name}: OK`);
        process.exit(0);
    }
}

function required(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set (bash scripts/with-secrets.sh dev … або export ${name}=…)`);
    return value;
}

export function run(main: () => Promise<void>): void {
    main().catch((e) => {
        console.error(`demo failed: ${(e as Error).message}`);
        process.exit(1);
    });
}
