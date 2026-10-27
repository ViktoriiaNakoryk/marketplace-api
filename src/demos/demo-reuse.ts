import { AuthDemo } from './auth-demo';
import { Checks, run } from './redis-demo';

run(async () => {
    const checks = new Checks('demo:reuse');
    const demo = await AuthDemo.start();
    try {
        const buyer = await demo.givenUser('buyer');

        const login = await demo.login(buyer.email);
        const r1 = login.body.refreshToken as string;

        const rotated = await demo.refresh(r1);
        const r2 = rotated.body.refreshToken as string;
        const a2 = rotated.body.accessToken as string;

        const reuse = await demo.refresh(r1);
        const r2AfterReuse = await demo.refresh(r2);
        const a2AfterReuse = await demo.call('GET', '/orders', { token: a2 });

        const family = await demo.pool.query(
            `SELECT count(DISTINCT family_id)::int AS families, count(*)::int AS total, count(revoked_at)::int AS revoked
             FROM refresh_tokens WHERE user_id = $1`,
            [buyer.id],
        );
        const { families, total, revoked } = family.rows[0];
        console.log(`# family: ${families} family, ${revoked}/${total} tokens revoked after reuse`);

        checks.expect(login.status === 200, 'login succeeds');
        checks.expect(rotated.status === 200 && r2 !== r1, 'refresh rotates');
        checks.expect(reuse.status === 401, 'reused refresh token is rejected');
        checks.expect(r2AfterReuse.status === 401, 'the whole family dies on reuse, including the honest r2');
        checks.expect(families === 1 && revoked === total, 'every token of the family is revoked');

        checks.print({
            login: login.status,
            'r1-refresh': rotated.status,
            'r1-reuse': reuse.status,
            'r2-after-reuse': r2AfterReuse.status,
            'a2-after-reuse': a2AfterReuse.status,
        });
    } finally {
        await demo.cleanup();
    }
    checks.finish();
});
