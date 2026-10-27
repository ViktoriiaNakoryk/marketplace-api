import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

const COMPARE_AND_DELETE = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end`;

export async function acquireLock(redis: Redis, key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
    return ok === 'OK' ? token : null;
}

export async function releaseLock(redis: Redis, key: string, token: string): Promise<boolean> {
    const deleted = (await redis.eval(COMPARE_AND_DELETE, 1, key, token)) as number;
    return deleted === 1;
}
