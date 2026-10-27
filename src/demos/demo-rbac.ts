import { AuthDemo } from './auth-demo';
import { Checks, run } from './redis-demo';

function tamper(token: string): string {
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    payload.role = 'admin';
    parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return parts.join('.');
}

run(async () => {
    const checks = new Checks('demo:rbac');
    const demo = await AuthDemo.start();
    try {
        const owner = await demo.givenUser('buyer');
        const stranger = await demo.givenUser('buyer');
        const seller = await demo.givenUser('seller');
        const [ownerToken, strangerToken, sellerToken] = await Promise.all(
            [owner, stranger, seller].map(async (u) => (await demo.login(u.email)).body.accessToken as string),
        );

        const newProduct = (sku: string) => ({
            sku,
            name: 'RBAC demo product',
            description: 'Created by demo:rbac',
            category: 'Demo',
            brand: 'Demo',
            price: 4_900,
            stock: 10,
        });
        const roleDenied = await demo.call('POST', '/products', { token: ownerToken, body: newProduct(`RBAC-B-${Date.now()}`) });
        const roleAllowed = await demo.call('POST', '/products', { token: sellerToken, body: newProduct(`RBAC-S-${Date.now()}`) });

        const order = await demo.call('POST', '/orders', {
            token: ownerToken,
            headers: { 'idempotency-key': `rbac-${Date.now()}-${process.pid}` },
            body: { items: [{ productId: roleAllowed.body.id, quantity: 1 }] },
        });
        const path = `/orders/${order.body.id}`;

        const anon = await demo.call('GET', path);
        const own = await demo.call('GET', path, { token: ownerToken });
        const foreign = await demo.call('GET', path, { token: strangerToken });
        const tampered = await demo.call('GET', path, { token: tamper(strangerToken) });
        const tamperedWrite = await demo.call('POST', '/products', { token: tamper(ownerToken), body: newProduct(`RBAC-T-${Date.now()}`) });
        const onBehalf = await demo.call('POST', '/orders', {
            token: strangerToken,
            headers: { 'idempotency-key': `rbac-behalf-${Date.now()}-${process.pid}` },
            body: { buyerId: owner.id, items: [{ productId: roleAllowed.body.id, quantity: 1 }] },
        });

        checks.expect(order.status === 201, `buyer places an order (${order.status})`);
        checks.expect(anon.status === 401, 'anonymous → 401');
        checks.expect(own.status === 200, 'owner → 200');
        checks.expect(foreign.status === 403, 'another buyer → 403');
        checks.expect(roleDenied.status === 403, 'buyer cannot write products');
        checks.expect(roleAllowed.status === 201 || roleAllowed.status === 200, 'seller writes products');
        checks.expect(tampered.status === 401 && tamperedWrite.status === 401, 'forged payload is rejected by signature check');
        checks.expect(onBehalf.status === 403, 'cannot place an order on behalf of another buyer');

        checks.print({
            anon: anon.status,
            own: own.status,
            foreign: foreign.status,
            'role-denied': roleDenied.status,
            'role-allowed': roleAllowed.status,
            tampered: tamperedWrite.status,
            'tampered-read': tampered.status,
            'order-on-behalf': onBehalf.status,
        });
    } finally {
        await demo.cleanup();
    }
    checks.finish();
});
