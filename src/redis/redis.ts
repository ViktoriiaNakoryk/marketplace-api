import Redis, { type RedisOptions } from 'ioredis';

export function requiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set (bash scripts/with-secrets.sh dev … або export ${name}=…)`);
    return value;
}

export function connectRedis(url: string, options: RedisOptions = {}): Redis {
    return new Redis(url, { lazyConnect: false, ...options });
}

export async function configValue(redis: Redis, parameter: string): Promise<string> {
    const reply = (await redis.config('GET', parameter)) as string[];
    return reply[1] ?? '';
}
