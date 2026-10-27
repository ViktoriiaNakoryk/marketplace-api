import type { Pool } from 'pg';
import { ORDER_ID, PRODUCT_ID } from './pact.config';

export const BUYER_ID = 9001;
const SELLER_ID = 9002;

async function givenProduct(pool: Pool): Promise<void> {
    await pool.query(
        `INSERT INTO users (id, email, "fullName", role, balance) VALUES
             ($1, 'pact.buyer@test.local', 'Pact Buyer', 'buyer', 1000000),
             ($2, 'pact.seller@test.local', 'Pact Seller', 'seller', 0)
         ON CONFLICT DO NOTHING`,
        [BUYER_ID, SELLER_ID],
    );
    await pool.query(
        `INSERT INTO products (id, "sellerId", sku, name, description, category, brand, price, stock)
         VALUES ($1, $2, 'MP-9001', 'Кросівки шкіряні', 'Чоловічі шкіряні кросівки', 'Взуття', 'Nike', 19900, 25)
         ON CONFLICT DO NOTHING`,
        [PRODUCT_ID, SELLER_ID],
    );
}

async function givenOrder(pool: Pool): Promise<void> {
    await givenProduct(pool);
    await pool.query(
        `INSERT INTO orders (id, "buyerId", status, total) VALUES ($1, $2, 'pending', 39800) ON CONFLICT DO NOTHING`,
        [ORDER_ID, BUYER_ID],
    );
    await pool.query(
        `INSERT INTO order_items (id, "orderId", "productId", quantity, "unitPrice")
         VALUES ($1, $1, $2, 2, 19900)
         ON CONFLICT DO NOTHING`,
        [ORDER_ID, PRODUCT_ID],
    );
}

export function stateHandlers(pool: Pool) {
    return {
        [`order ${ORDER_ID} exists`]: () => givenOrder(pool),
        [`product ${PRODUCT_ID} exists`]: () => givenProduct(pool),
    };
}
