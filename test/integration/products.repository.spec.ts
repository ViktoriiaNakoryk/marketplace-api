import { ProductsRepository } from '../../src/products/products.repository';
import { UsersRepository } from '../../src/users/users.repository';
import { aProduct, aSeller } from '../testkit/builders';
import { useRollbackTransaction } from '../testkit/transaction';

describe('ProductsRepository (Postgres)', () => {
    const db = useRollbackTransaction();
    const products = () => new ProductsRepository(db());
    const givenSeller = () => new UsersRepository(db()).create(aSeller());

    it('creates a product and reads it back by id', async () => {
        const seller = await givenSeller();
        const created = await products().create(aProduct(seller.id, { price: 49_900 }));

        expect(await products().findById(created.id)).toEqual(created);
        expect(created).toMatchObject({ sellerId: seller.id, price: 49_900 });
    });

    it('rejects a duplicate sku with unique violation 23505', async () => {
        const seller = await givenSeller();
        const first = await products().create(aProduct(seller.id));

        await expect(products().create(aProduct(seller.id, { sku: first.sku }))).rejects.toMatchObject({
            code: '23505',
            message: expect.stringContaining('duplicate key'),
        });
    });

    it('rejects a product of a non-existent seller with foreign key violation 23503', async () => {
        await expect(products().create(aProduct(999_999))).rejects.toMatchObject({ code: '23503' });
    });

    it('rejects a non-positive price via CHECK constraint 23514', async () => {
        const seller = await givenSeller();

        await expect(products().create(aProduct(seller.id, { price: 0 }))).rejects.toMatchObject({ code: '23514' });
    });

    it('pages through the catalogue with a keyset cursor', async () => {
        const seller = await givenSeller();
        const created = [];
        for (let i = 0; i < 3; i++) created.push(await products().create(aProduct(seller.id)));
        const after = String(created[0].id - 1);

        const first = await products().list(2, after);
        const second = await products().list(2, first.next_cursor!);

        expect(first.items.map((p) => p.id)).toEqual([created[0].id, created[1].id]);
        expect(first.next_cursor).toBe(String(created[1].id));
        expect(second.items.map((p) => p.id)).toEqual([created[2].id]);
        expect(second.next_cursor).toBeNull();
    });
});
