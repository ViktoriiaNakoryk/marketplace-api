import 'reflect-metadata';
import { Pool } from 'pg';
import { AppDataSource } from '../data-source';
import { CountingQueryable } from '../database/counting-queryable';
import { ProductCardCache } from '../products/product-card.cache';
import { ProductsRepository } from '../products/products.repository';
import { acquireLock, releaseLock } from '../redis/lock';
import { configValue, connectRedis, requiredEnv } from '../redis/redis';
import { UsersRepository } from '../users/users.repository';
import { Checks, demoTag, run } from './redis-demo';

const WARM = 60;
const CONCURRENT = 25;
const WARM_READS = 100;

run(async () => {
    const checks = new Checks('demo:cache');
    const redis = connectRedis(requiredEnv('REDIS_URL'));
    process.env.DATABASE_URL ??= process.env.DB_URL;
    requiredEnv('DATABASE_URL');

    await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    await AppDataSource.destroy();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

    const policy = await configValue(redis, 'maxmemory-policy');
    const maxmemory = Number(await configValue(redis, 'maxmemory'));
    console.log(`# cache instance: maxmemory-policy=${policy} maxmemory=${maxmemory}`);

    const tag = demoTag();
    const seller = await new UsersRepository(pool).create({
        email: `cache-seller-${tag}@demo.local`,
        fullName: 'Cache Demo Seller',
        role: 'seller',
        balance: 0,
    });
    const products = new ProductsRepository(pool);
    const ids: number[] = [];
    for (let i = 0; i < WARM; i++) {
        const p = await products.create({
            sellerId: seller.id,
            sku: `CACHE-${tag}-${i}`,
            name: `Cache demo product ${i}`,
            description: 'Product created by the Redis cache demo',
            category: 'Demo',
            brand: 'Demo',
            price: 1_000 + i,
            stock: 10,
        });
        ids.push(p.id);
    }

    const db = new CountingQueryable(pool);
    const cache = new ProductCardCache(redis, (id) => new ProductsRepository(db).findCard(id));

    try {
        await redis.del(...ids.map((id) => cache.key(id)));

        for (const id of ids) await cache.get(id);
        const ttls = await Promise.all(ids.map((id) => redis.ttl(cache.key(id))));
        const warmed = ttls.filter((t) => t > 0).length;
        const ttlDistinct = new Set(ttls.filter((t) => t > 0)).size;
        console.log(`# warmed ${warmed} cards, TTL range ${Math.min(...ttls)}..${Math.max(...ttls)}s, ${db.calls} db calls`);

        const hot = ids[0];
        await redis.del(cache.key(hot));
        db.calls = 0;
        const started = Date.now();
        const cards = await Promise.all(Array.from({ length: CONCURRENT }, () => cache.get(hot)));
        const stampedeCalls = db.calls;
        console.log(`# ${CONCURRENT} concurrent reads of an expired key took ${Date.now() - started}ms, ${stampedeCalls} db call(s)`);

        db.calls = 0;
        for (let i = 0; i < WARM_READS; i++) await cache.get(ids[i % ids.length]);
        const warmCalls = db.calls;

        const lockKey = `lock:demo:${tag}`;
        const mine = await acquireLock(redis, lockKey, 5_000);
        const foreignReleased = await releaseLock(redis, lockKey, 'someone-elses-token');
        const ownReleased = mine ? await releaseLock(redis, lockKey, mine) : false;

        checks.expect(policy !== 'noeviction', `cache instance must evict, got ${policy}`);
        checks.expect(maxmemory > 0, 'cache instance must have maxmemory');
        checks.expect(stampedeCalls === 1, `stampede gave ${stampedeCalls} db calls`);
        checks.expect(warmCalls === 0, `warm cache gave ${warmCalls} db calls`);
        checks.expect(cards.every((c) => c?.id === hot), 'every concurrent reader got the card');
        checks.expect(!foreignReleased && ownReleased, 'lock is released only by its owner');

        checks.print({
            'cache-lru': policy !== 'noeviction' ? 1 : 0,
            'cache-maxmemory': maxmemory > 0 ? 1 : 0,
            warmed,
            'ttl-distinct': ttlDistinct,
            concurrent: CONCURRENT,
            'db-calls': stampedeCalls,
            'db-calls-warm': warmCalls,
            'lock-foreign-release': foreignReleased ? 1 : 0,
            'lock-own-release': ownReleased ? 1 : 0,
        });
    } finally {
        await redis.del(...ids.map((id) => cache.key(id)));
        await pool.query('DELETE FROM products WHERE id = ANY($1::bigint[])', [ids]);
        await pool.query('DELETE FROM users WHERE id = $1', [seller.id]);
        await pool.end();
        redis.disconnect();
    }
    checks.finish();
});
