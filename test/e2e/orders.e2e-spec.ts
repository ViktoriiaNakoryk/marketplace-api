import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { ProductsRepository } from '../../src/products/products.repository';
import { UsersRepository } from '../../src/users/users.repository';
import { aProduct, aSeller, aUser } from '../testkit/builders';

describe('Orders (e2e)', () => {
    let app: INestApplication<App>;
    let pool: Pool;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = configureApp(moduleRef.createNestApplication());
        await app.init();
        pool = new Pool({ connectionString: process.env.DB_URL });
    });

    afterAll(async () => {
        await pool.end();
        await app.close();
    });

    async function givenBuyerAndProduct() {
        const users = new UsersRepository(pool);
        const seller = await users.create(aSeller());
        const buyer = await users.create(aUser());
        const product = await new ProductsRepository(pool).create(aProduct(seller.id, { price: 79_900 }));
        return { buyer, product };
    }

    it('creates an order and reads it back', async () => {
        const { buyer, product } = await givenBuyerAndProduct();

        const created = await request(app.getHttpServer())
            .post('/orders')
            .set('Idempotency-Key', `e2e-${Date.now()}`)
            .send({ buyerId: buyer.id, items: [{ productId: product.id, quantity: 2 }] })
            .expect(HttpStatus.CREATED);

        expect(created.body).toMatchObject({
            id: expect.any(Number),
            buyerId: buyer.id,
            status: 'pending',
            total: 2 * 79_900,
            items: [{ productId: product.id, quantity: 2, unitPrice: 79_900 }],
        });

        const read = await request(app.getHttpServer()).get(`/orders/${created.body.id}`).expect(HttpStatus.OK);

        expect(read.body).toEqual(created.body);
    });

    it('replays the same order for a repeated Idempotency-Key and rejects a different body with 422', async () => {
        const { buyer, product } = await givenBuyerAndProduct();
        const key = `e2e-idem-${Date.now()}`;
        const body = { buyerId: buyer.id, items: [{ productId: product.id, quantity: 1 }] };
        const post = (payload: object) =>
            request(app.getHttpServer()).post('/orders').set('Idempotency-Key', key).send(payload);

        const first = await post(body).expect(HttpStatus.CREATED);
        const second = await post(body).expect(HttpStatus.CREATED);

        expect(second.body.id).toBe(first.body.id);
        expect(second.headers['idempotent-replayed']).toBe('true');
        await post({ ...body, items: [{ productId: product.id, quantity: 5 }] }).expect(HttpStatus.UNPROCESSABLE_ENTITY);

        const { rows } = await pool.query('SELECT count(*)::int AS n FROM orders WHERE "buyerId" = $1', [buyer.id]);
        expect(rows[0].n).toBe(1);
    });

    it('returns 404 for an order that does not exist', async () => {
        const res = await request(app.getHttpServer()).get('/orders/999999').expect(404);

        expect(res.body).toMatchObject({ statusCode: 404, message: 'Order 999999 not found' });
    });

    it('rejects an order without items with 400 from ValidationPipe', async () => {
        const { buyer } = await givenBuyerAndProduct();

        const res = await request(app.getHttpServer())
            .post('/orders')
            .set('Idempotency-Key', `e2e-empty-${Date.now()}`)
            .send({ buyerId: buyer.id, items: [] })
            .expect(HttpStatus.BAD_REQUEST);

        expect(res.body.message).toEqual(expect.arrayContaining(['items must contain at least 1 elements']));
    });
});
