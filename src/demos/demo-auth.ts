import { AuthDemo, jtiOf } from './auth-demo';
import { Checks, run } from './redis-demo';

run(async () => {
    const checks = new Checks('demo:auth');
    const demo = await AuthDemo.start();
    try {
        const buyer = await demo.givenUser('buyer');

        const login = await demo.login(buyer.email);
        const noToken = await demo.call('GET', '/orders');
        const withToken = await demo.call('GET', '/orders', { token: login.body.accessToken });

        const refreshed = await demo.refresh(login.body.refreshToken);
        const access = refreshed.body.accessToken as string;
        const refresh = refreshed.body.refreshToken as string;

        const logout = await demo.call('POST', '/auth/logout', { token: access });
        const afterLogout = await demo.call('GET', '/orders', { token: access });
        const refreshAfterLogout = await demo.refresh(refresh);
        const previousAccess = await demo.call('GET', '/orders', { token: login.body.accessToken });

        const denied = await demo.pool.query(`SELECT expires_at - now() AS ttl FROM access_token_denylist WHERE jti = $1`, [jtiOf(access)]);
        const family = await demo.pool.query(
            `SELECT count(*)::int AS total, count(revoked_at)::int AS revoked FROM refresh_tokens WHERE user_id = $1`,
            [buyer.id],
        );
        console.log(
            `# denylist ttl for jti=${jtiOf(access)}: ${denied.rows[0]?.ttl?.minutes ?? 0}m${denied.rows[0]?.ttl?.seconds ?? 0}s; ` +
                `refresh family ${family.rows[0].revoked}/${family.rows[0].total} revoked`,
        );

        checks.expect(login.status === 200 && typeof login.body.refreshToken === 'string', 'login issues a pair');
        checks.expect(login.body.refreshToken.split('.').length !== 3, 'refresh token is opaque, not a JWT');
        checks.expect(noToken.status === 401, 'no token → 401');
        checks.expect(withToken.status === 200, 'valid token → 200');
        checks.expect(refreshed.status === 200 && refresh !== login.body.refreshToken, 'refresh rotates the pair');
        checks.expect(logout.status === 204 || logout.status === 200, 'logout succeeds');
        checks.expect(afterLogout.status === 401, 'access token is dead after logout');
        checks.expect(refreshAfterLogout.status === 401, 'refresh token is dead after logout');
        checks.expect(denied.rowCount === 1, 'jti is in the denylist');

        checks.print({
            login: login.status,
            'no-token': noToken.status,
            'with-token': withToken.status,
            refresh: refreshed.status,
            logout: logout.status,
            'after-logout': afterLogout.status,
            'refresh-after-logout': refreshAfterLogout.status,
            'older-access-after-logout': previousAccess.status,
        });
    } finally {
        await demo.cleanup();
    }
    checks.finish();
});
