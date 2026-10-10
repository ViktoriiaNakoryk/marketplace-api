import 'reflect-metadata';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { connect, type Channel, type ChannelModel } from 'amqplib';
import { Pool } from 'pg';
import { AppDataSource } from '../data-source';
import { AmqpEventPublisher, type EventPublisher } from '../messaging/event-publisher';
import { assertTopology, FULFILLMENT_DLQ, FULFILLMENT_QUEUE } from '../messaging/topology';
import { OrderEventsService } from '../orders/order-events.service';
import { OrdersRepository } from '../orders/orders.repository';
import { OrdersService } from '../orders/orders.service';
import { ProductsRepository } from '../products/products.repository';
import { UsersRepository } from '../users/users.repository';

export type ConsumerLine = { kind: string } & Record<string, any>;

export class DemoConsumer {
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

        const { consumerCount } = await channel.checkQueue(FULFILLMENT_QUEUE);
        if (consumerCount > 0) {
            throw new Error(`${FULFILLMENT_QUEUE} already has ${consumerCount} consumer(s) — stop npm run consumer first`);
        }
        await channel.purgeQueue(FULFILLMENT_QUEUE);
        await channel.purgeQueue(FULFILLMENT_DLQ);

        console.log(`# ${name}: topology asserted, ${FULFILLMENT_QUEUE} and ${FULFILLMENT_DLQ} purged`);
        return new Demo(name, pool, connection, channel, new AmqpEventPublisher(brokerUrl));
    }

    spawnConsumer(env: Record<string, string> = {}): DemoConsumer {
        const child = spawn(process.execPath, [join(__dirname, '..', 'consumer.js')], {
            env: { ...process.env, CONSUMER_REPORT: 'json', ...env },
            stdio: ['ignore', 'pipe', 'inherit'],
        });
        return new DemoConsumer(child);
    }

    ordersService(publisher: EventPublisher = this.publisher): OrdersService {
        return new OrdersService(new OrdersRepository(this.pool), new OrderEventsService(), publisher);
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
