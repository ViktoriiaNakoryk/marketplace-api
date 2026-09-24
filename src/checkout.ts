import { DataSource } from 'typeorm';

export type CheckoutParams = {
    buyerId: string | number;
    productId: string | number;
    quantity: number;
};

export type CheckoutResult = {
    orderId: string;
    total: number;
};

export class CheckoutError extends Error {
    constructor(public readonly reason: 'OUT_OF_STOCK' | 'INSUFFICIENT_FUNDS') {
        super(reason);
        this.name = 'CheckoutError';
    }
}

export async function checkout(ds: DataSource, params: CheckoutParams): Promise<CheckoutResult> {
    const { buyerId, productId, quantity } = params;

    return ds.transaction(async (manager) => {
        const [decremented] = await manager.query(
            `UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING price`,
            [quantity, productId],
        );
        if (decremented.length === 0) {
            throw new CheckoutError('OUT_OF_STOCK');
        }

        const unitPrice = Number(decremented[0].price);
        const total = unitPrice * quantity;

        const [debited] = await manager.query(
            `UPDATE users SET balance = balance - $1 WHERE id = $2 AND balance >= $1 RETURNING balance`,
            [total, buyerId],
        );
        if (debited.length === 0) {
            throw new CheckoutError('INSUFFICIENT_FUNDS');
        }

        const order = await manager.query(
            `INSERT INTO orders ("buyerId", status, total, "createdAt") VALUES ($1, 'paid', $2, now()) RETURNING id`,
            [buyerId, total],
        );
        const orderId = order[0].id as string;

        await manager.query(
            `INSERT INTO order_items ("orderId", "productId", quantity, "unitPrice") VALUES ($1, $2, $3, $4)`,
            [orderId, productId, quantity, unitPrice],
        );

        await manager.query(
            `INSERT INTO jobs (type, payload, status) VALUES ('order_receipt', $1, 'pending')`,
            [JSON.stringify({ orderId, buyerId, total })],
        );

        return { orderId, total };
    });
}
