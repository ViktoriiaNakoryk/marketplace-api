import { MatchersV3, PactV3 } from '@pact-foundation/pact';
import { MarketplaceClient } from './marketplace-client';
import {
    CONSUMER,
    ORDER_ID,
    PACT_DIR,
    PRODUCT_ID,
    PROVIDER,
    STATE_ORDER_EXISTS,
    STATE_PRODUCT_EXISTS,
} from './pact.config';

const { eachLike, integer, regex, string } = MatchersV3;

const jsonContentType = { 'Content-Type': regex(/application\/json.*/, 'application/json; charset=utf-8') };

describe('marketplace-web → marketplace-api', () => {
    const pact = new PactV3({ consumer: CONSUMER, provider: PROVIDER, dir: PACT_DIR, logLevel: 'warn' });

    it('shows an order with its items', () => {
        pact.given(STATE_ORDER_EXISTS)
            .uponReceiving('a request for an existing order')
            .withRequest({ method: 'GET', path: `/orders/${ORDER_ID}`, headers: { Accept: 'application/json' } })
            .willRespondWith({
                status: 200,
                headers: jsonContentType,
                body: {
                    id: integer(ORDER_ID),
                    buyerId: integer(9001),
                    status: regex(/^(pending|paid|shipped|completed|cancelled|refunded)$/, 'pending'),
                    total: integer(39_800),
                    items: eachLike({
                        productId: integer(PRODUCT_ID),
                        name: string('Кросівки шкіряні'),
                        quantity: integer(2),
                        unitPrice: integer(19_900),
                    }),
                },
            });

        return pact.executeTest(async (mock) => {
            const order = await new MarketplaceClient(mock.url).getOrder(ORDER_ID);

            expect(order.id).toBe(ORDER_ID);
            expect(order.items[0]).toMatchObject({ productId: PRODUCT_ID, quantity: 2 });
        });
    });

    it('shows a product card', () => {
        pact.given(STATE_PRODUCT_EXISTS)
            .uponReceiving('a request for an existing product')
            .withRequest({ method: 'GET', path: `/products/${PRODUCT_ID}`, headers: { Accept: 'application/json' } })
            .willRespondWith({
                status: 200,
                headers: jsonContentType,
                body: {
                    id: integer(PRODUCT_ID),
                    sku: string('MP-9001'),
                    name: string('Кросівки шкіряні'),
                    price: integer(19_900),
                    stock: integer(25),
                },
            });

        return pact.executeTest(async (mock) => {
            const product = await new MarketplaceClient(mock.url).getProduct(PRODUCT_ID);

            expect(product).toMatchObject({ id: PRODUCT_ID, price: 19_900 });
        });
    });
});
