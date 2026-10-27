import { randomInt } from 'node:crypto';
import type Redis from 'ioredis';
import { acquireLock, releaseLock } from '../redis/lock';
import type { ProductCard } from './products.repository';

export type ProductCardCacheOptions = {
    ttlSec: number;
    jitterSec: number;
    missingTtlSec: number;
    lockTtlMs: number;
    waitStepMs: number;
    waitTimeoutMs: number;
};

const DEFAULTS: ProductCardCacheOptions = {
    ttlSec: 300,
    jitterSec: 60,
    missingTtlSec: 30,
    lockTtlMs: 5_000,
    waitStepMs: 20,
    waitTimeoutMs: 3_000,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ProductCardCache {
    private readonly options: ProductCardCacheOptions;

    constructor(
        private readonly redis: Redis,
        private readonly load: (id: number) => Promise<ProductCard | null>,
        options: Partial<ProductCardCacheOptions> = {},
    ) {
        this.options = { ...DEFAULTS, ...options };
    }

    key(id: number): string {
        return `product:card:v1:${id}`;
    }

    ttlSec(): number {
        return this.options.ttlSec + randomInt(0, this.options.jitterSec + 1);
    }

    async get(id: number): Promise<ProductCard | null> {
        const cached = await this.read(id);
        if (cached !== undefined) return cached;

        const key = this.key(id);
        const lockKey = `lock:${key}`;
        const deadline = Date.now() + this.options.waitTimeoutMs;

        for (;;) {
            let token: string | null;
            try {
                token = await acquireLock(this.redis, lockKey, this.options.lockTtlMs);
            } catch {
                return this.load(id);
            }

            if (token) {
                try {
                    const fresh = await this.read(id);
                    if (fresh !== undefined) return fresh;
                    const card = await this.load(id);
                    await this.write(id, card);
                    return card;
                } finally {
                    await releaseLock(this.redis, lockKey, token).catch(() => false);
                }
            }

            await sleep(this.options.waitStepMs);
            const filled = await this.read(id);
            if (filled !== undefined) return filled;
            if (Date.now() > deadline) return this.load(id);
        }
    }

    async invalidate(id: number): Promise<void> {
        await this.redis.del(this.key(id)).catch(() => 0);
    }

    private async read(id: number): Promise<ProductCard | null | undefined> {
        try {
            const raw = await this.redis.get(this.key(id));
            return raw === null ? undefined : (JSON.parse(raw) as ProductCard | null);
        } catch {
            return undefined;
        }
    }

    private async write(id: number, card: ProductCard | null): Promise<void> {
        const ttl = card ? this.ttlSec() : this.options.missingTtlSec;
        try {
            await this.redis.set(this.key(id), JSON.stringify(card), 'EX', ttl);
        } catch {
            return;
        }
    }
}
