import 'reflect-metadata';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { User } from './entities/user.entity';
import { Product } from './entities/product.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { Job } from './entities/job.entity';

const url = process.env.DATABASE_URL ?? process.env.DB_URL;

export const AppDataSource = new DataSource({
    type: 'postgres',
    ...(url
        ? { url }
        : {
              host: process.env.DB_HOST,
              port: Number(process.env.DB_PORT ?? 5432),
              username: process.env.DB_USER,
              password: process.env.DB_PASSWORD,
              database: process.env.DB_NAME,
          }),
    synchronize: false,
    logging: false,
    poolSize: 60,
    entities: [User, Product, Order, OrderItem, Job],
    migrations: [join(__dirname, 'migrations', '*.js')],
});
