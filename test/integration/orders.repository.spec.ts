import { OrdersRepository } from '../../src/orders/orders.repository';
import { ProductsRepository } from '../../src/products/products.repository';
import { UsersRepository } from '../../src/users/users.repository';
import { aProduct, anItem, anOrder, aSeller, aUser } from '../testkit/builders';
import { useRollbackTransaction } from '../testkit/transaction';

describe('OrdersRepository (Postgres)', () => {
    const db = useRollbackTransaction();
    const orders = () => new OrdersRepository(db());

    async function givenCatalogue() {
        const users = new UsersRepository(db());
        const products = new ProductsRepository(db());
        const seller = await users.create(aSeller());
        const buyer = await users.create(aUser());
        const sneakers = await products.create(aProduct(seller.id, { name: 'Кросівки', price: 249_900 }));
        const cap = await products.create(aProduct(seller.id, { name: 'Кепка', price: 49_900 }));
        return { buyer, sneakers, cap };
    }

    it('computes the total from catalogue prices via JOIN and returns the items', async () => {
        const { buyer, sneakers, cap } = await givenCatalogue();

        const order = await orders().create(
            anOrder(buyer.id, { items: [anItem(sneakers.id, 1), anItem(cap.id, 3)] }),
        );

        expect(order).toMatchObject({
            buyerId: buyer.id,
            status: 'pending',
            total: 249_900 + 3 * 49_900,
            items: [
                { productId: sneakers.id, name: 'Кросівки', quantity: 1, unitPrice: 249_900 },
                { productId: cap.id, name: 'Кепка', quantity: 3, unitPrice: 49_900 },
            ],
        });
    });

    it('finds an order with its items aggregated, and null for a missing id', async () => {
        const { buyer, cap } = await givenCatalogue();
        const created = await orders().create(anOrder(buyer.id, { items: [anItem(cap.id, 2)] }));

        expect(await orders().findById(created!.id)).toEqual(created);
        expect(await orders().findById(999_999)).toBeNull();
    });

    it('writes nothing when an item references an unknown product', async () => {
        const { buyer, cap } = await givenCatalogue();

        const order = await orders().create(anOrder(buyer.id, { items: [anItem(cap.id), anItem(999_999)] }));

        expect(order).toBeNull();
        const { rows } = await db().query('SELECT count(*)::int AS n FROM orders WHERE "buyerId" = $1', [buyer.id]);
        expect(rows[0].n).toBe(0);
    });

    it('rejects an order of a non-existent buyer with foreign key violation 23503', async () => {
        const { cap } = await givenCatalogue();

        await expect(orders().create(anOrder(999_999, { items: [anItem(cap.id)] }))).rejects.toMatchObject({
            code: '23503',
            message: expect.stringContaining('foreign key'),
        });
    });
});
