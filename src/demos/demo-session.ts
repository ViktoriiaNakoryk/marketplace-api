import { configValue, connectRedis, requiredEnv } from '../redis/redis';
import { sessionMiddleware, SessionStore, type SessionRequest } from '../sessions/session.store';
import { Checks, close, listen, run, sleep } from './redis-demo';

async function startPod(url: string) {
    const redis = connectRedis(url);
    const store = new SessionStore(redis, 1800);
    const { server, url: base } = await listen(sessionMiddleware(store), (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ sid: (req as SessionRequest).session?.id }));
    });
    return { redis, store, server, base };
}

async function call(base: string, cookie?: string) {
    const res = await fetch(`${base}/me`, { headers: cookie ? { cookie } : {} });
    const body = (await res.json()) as { sid: string };
    const setCookie = res.headers.get('set-cookie') ?? '';
    return { sid: body.sid, cookie: setCookie.split(';')[0] };
}

run(async () => {
    const checks = new Checks('demo:session');
    const url = requiredEnv('REDIS_QUEUE_URL');

    let pod = await startPod(url);
    console.log(`# session store: maxmemory-policy=${await configValue(pod.redis, 'maxmemory-policy')} (not the LRU cache)`);
    const sids = new Set<string>();

    const first = await call(pod.base);
    sids.add(first.sid);
    const cookie = first.cookie;
    sids.add((await call(pod.base, cookie)).sid);

    await sleep(2_000);
    const before = await pod.redis.pttl(pod.store.key(first.sid));
    sids.add((await call(pod.base, cookie)).sid);
    const after = await pod.redis.pttl(pod.store.key(first.sid));
    console.log(`# pttl before activity ${before}ms, after ${after}ms`);

    await close(pod.server);
    pod.redis.disconnect();
    pod = await startPod(url);
    console.log('# process "restarted": new server, new Redis connection');
    sids.add((await call(pod.base, cookie)).sid);
    const requests = 4;

    const inRedis = await pod.redis.exists(pod.store.key(first.sid));
    await pod.store.destroy(first.sid);
    await close(pod.server);
    pod.redis.disconnect();

    checks.expect(sids.size === 1, `requests produced ${sids.size} sessions`);
    checks.expect(inRedis === 1, 'session key lives in Redis');
    checks.expect(after > before, 'activity renews the TTL');

    checks.print({
        requests,
        sessions: sids.size,
        'in-redis': inRedis,
        'ttl-renewed': after > before ? 1 : 0,
    });
    checks.finish();
});
