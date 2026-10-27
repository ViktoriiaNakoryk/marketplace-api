import { connectRedis, requiredEnv } from '../redis/redis';
import { rateLimitMiddleware, SlidingWindowLimiter } from '../rate-limit/sliding-window.limiter';
import { Checks, close, demoTag, listen, run } from './redis-demo';

const LIMIT = 5;
const WINDOW_MS = 10_000;
const REQUESTS = 12;
const INSTANCES = 2;

run(async () => {
    const checks = new Checks('demo:ratelimit');
    const url = requiredEnv('REDIS_QUEUE_URL');
    const client = `demo-${demoTag()}`;

    const pods = await Promise.all(
        Array.from({ length: INSTANCES }, async () => {
            const redis = connectRedis(url);
            const limiter = new SlidingWindowLimiter(redis, LIMIT, WINDOW_MS);
            const http = await listen(
                rateLimitMiddleware(limiter, (req) => String(req.headers['x-client-id'] ?? 'anonymous')),
                (_req, res) => res.end('ok'),
            );
            return { redis, limiter, ...http };
        }),
    );

    let allowed = 0;
    let blocked = 0;
    let status = 0;
    let retryAfter: string | null = null;
    for (let i = 0; i < REQUESTS; i++) {
        const pod = pods[i % pods.length];
        const res = await fetch(`${pod.url}/products`, { headers: { 'x-client-id': client } });
        await res.text();
        if (res.status === 429) {
            blocked++;
            status = res.status;
            retryAfter = res.headers.get('retry-after');
        } else {
            allowed++;
        }
        console.log(`# request ${i + 1} → pod ${i % pods.length}: ${res.status}${res.status === 429 ? ` Retry-After: ${retryAfter}` : ''}`);
    }

    await pods[0].redis.del(pods[0].limiter.key(client));
    for (const pod of pods) {
        await close(pod.server);
        pod.redis.disconnect();
    }

    checks.expect(allowed === LIMIT, `two pods let through ${allowed} requests with limit ${LIMIT}`);
    checks.expect(blocked >= 1 && status === 429, 'excess requests are rejected with 429');
    checks.expect(retryAfter !== null && Number(retryAfter) >= 1, 'Retry-After is set');

    checks.print({
        instances: INSTANCES,
        limit: LIMIT,
        requests: REQUESTS,
        allowed,
        blocked,
        status,
        'retry-after': retryAfter !== null ? 1 : 0,
    });
    checks.finish();
});
