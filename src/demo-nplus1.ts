import 'reflect-metadata';
import { join } from 'node:path';
import { DataSource, Logger } from 'typeorm';
import { User } from './entities/user.entity';
import { Product } from './entities/product.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';

class QueryCountLogger implements Logger {
    count = 0;
    private echo = false;

    reset(echo: boolean): void {
        this.count = 0;
        this.echo = echo;
    }

    logQuery(query: string): void {
        this.count += 1;
        if (this.echo) {
            console.log(`  [sql] ${query}`);
        }
    }

    logQueryError(): void {}
    logQuerySlow(): void {}
    logSchemaBuild(): void {}
    logMigration(): void {}
    log(): void {}
}

async function main(): Promise<void> {
    const logger = new QueryCountLogger();

    const ds = new DataSource({
        type: 'postgres',
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? 5432),
        username: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        synchronize: false,
        logging: ['query'],
        logger,
        entities: [User, Product, Order, OrderItem],
        migrations: [join(__dirname, 'migrations', '*.js')],
    });

    await ds.initialize();

    console.log('--- наївно: запит на кожен елемент у циклі (order -> items -> product) ---');
    logger.reset(true);
    const naiveOrders = await ds.getRepository(Order).find();
    for (const order of naiveOrders) {
        const items = await ds.getRepository(OrderItem).find({
            where: { order: { id: order.id } },
            loadRelationIds: true,
        });
        for (const item of items) {
            await ds.getRepository(Product).findOneBy({ id: item.product as unknown as string });
        }
    }
    const naive = logger.count;

    logger.reset(false);
    const joinOrders = await ds.getRepository(Order).find({
        relations: { items: { product: true } },
    });
    const joined = logger.count;

    logger.reset(false);
    const queryStrategyOrders = await ds.getRepository(Order).find({
        relations: { items: { product: true } },
        relationLoadStrategy: 'query',
    });
    const queryStrategy = logger.count;

    const collectionSize = naiveOrders.length;
    const itemsLoaded = joinOrders.reduce((sum, o) => sum + o.items.length, 0);

    console.log('');
    console.log(`Замовлень у вибірці (N): ${collectionSize}, позицій: ${itemsLoaded}`);
    console.log('');
    console.log('Стратегія                                  | Запитів');
    console.log('-------------------------------------------|--------');
    console.log(`наївно (запит у циклі)                     | ${naive}`);
    console.log(`relations / leftJoinAndSelect (join)       | ${joined}`);
    console.log(`relationLoadStrategy: 'query'              | ${queryStrategy}`);
    console.log('');
    console.log(`До:  ${naive} (росте з N: 1 + orders + items)`);
    console.log(`Після (join):  ${joined}  |  Після ('query'): ${queryStrategy}  — константи, не залежать від N`);

    void queryStrategyOrders;
    await ds.destroy();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
