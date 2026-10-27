import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { InitialSchema1789282813091 } from '../../src/migrations/1789282813091-InitialSchema';
import { AddStockBalanceJobs1789286455673 } from '../../src/migrations/1789286455673-AddStockBalanceJobs';
import { AddFulfillments1791646524270 } from '../../src/migrations/1791646524270-AddFulfillments';
import { AddOutboxInboxIdempotency1791647666000 } from '../../src/migrations/1791647666000-AddOutboxInboxIdempotency';
import { AddAuth1793145600000 } from '../../src/migrations/1793145600000-AddAuth';
import { User } from '../../src/entities/user.entity';
import { Product } from '../../src/entities/product.entity';
import { Order } from '../../src/entities/order.entity';
import { OrderItem } from '../../src/entities/order-item.entity';
import { Job } from '../../src/entities/job.entity';
import { Fulfillment } from '../../src/entities/fulfillment.entity';

export async function startPostgres(): Promise<StartedPostgreSqlContainer> {
    const container = await new PostgreSqlContainer('postgres:16-alpine').start();

    const ds = new DataSource({
        type: 'postgres',
        url: container.getConnectionUri(),
        entities: [User, Product, Order, OrderItem, Job, Fulfillment],
        migrations: [InitialSchema1789282813091, AddStockBalanceJobs1789286455673, AddFulfillments1791646524270, AddOutboxInboxIdempotency1791647666000, AddAuth1793145600000],
    });
    await ds.initialize();
    await ds.runMigrations();
    await ds.destroy();

    return container;
}
