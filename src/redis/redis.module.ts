import { Global, Inject, Module, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { Env } from '../config/env.schema';
import { connectRedis } from './redis';

export const CACHE_REDIS = 'CACHE_REDIS';
export const STATE_REDIS = 'STATE_REDIS';

@Global()
@Module({
    providers: [
        {
            provide: CACHE_REDIS,
            inject: [ConfigService],
            useFactory: (config: ConfigService<Env, true>) => {
                const url = config.get('REDIS_URL', { infer: true });
                return url ? connectRedis(url, { maxRetriesPerRequest: 1 }) : null;
            },
        },
        {
            provide: STATE_REDIS,
            inject: [ConfigService],
            useFactory: (config: ConfigService<Env, true>) => {
                const url = config.get('REDIS_QUEUE_URL', { infer: true });
                return url ? connectRedis(url) : null;
            },
        },
    ],
    exports: [CACHE_REDIS, STATE_REDIS],
})
export class RedisModule implements OnModuleDestroy {
    constructor(
        @Optional() @Inject(CACHE_REDIS) private readonly cache: Redis | null,
        @Optional() @Inject(STATE_REDIS) private readonly state: Redis | null,
    ) {}

    async onModuleDestroy() {
        await Promise.all([this.cache?.quit(), this.state?.quit()]);
    }
}
