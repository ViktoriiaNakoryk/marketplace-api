import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type Redis from 'ioredis';

const SLIDING_WINDOW = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local member = ARGV[3]
local t = redis.call("TIME")
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call("ZREMRANGEBYSCORE", key, "-inf", now - window)
local count = redis.call("ZCARD", key)
if count < limit then
    redis.call("ZADD", key, now, member)
    redis.call("PEXPIRE", key, window)
    return {1, limit - count - 1, 0}
end
local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
return {0, 0, tonumber(oldest[2]) + window - now}`;

export type RateLimitDecision = { allowed: boolean; remaining: number; retryAfterMs: number };

export class SlidingWindowLimiter {
    constructor(
        private readonly redis: Redis,
        readonly limit: number,
        readonly windowMs: number,
        private readonly prefix = 'rl:',
    ) {}

    key(client: string): string {
        return `${this.prefix}${client}`;
    }

    async hit(client: string): Promise<RateLimitDecision> {
        const [allowed, remaining, retryAfterMs] = (await this.redis.eval(
            SLIDING_WINDOW,
            1,
            this.key(client),
            this.limit,
            this.windowMs,
            randomUUID(),
        )) as [number, number, number];
        return { allowed: allowed === 1, remaining, retryAfterMs };
    }
}

export function rateLimitMiddleware(
    limiter: SlidingWindowLimiter,
    clientOf: (req: IncomingMessage) => string = (req) => req.socket.remoteAddress ?? 'unknown',
) {
    return async (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void): Promise<void> => {
        let decision: RateLimitDecision;
        try {
            decision = await limiter.hit(clientOf(req));
        } catch {
            next();
            return;
        }
        res.setHeader('X-RateLimit-Limit', String(limiter.limit));
        res.setHeader('X-RateLimit-Remaining', String(decision.remaining));
        if (decision.allowed) {
            next();
            return;
        }
        res.statusCode = 429;
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ statusCode: 429, message: 'Too Many Requests' }));
    };
}
