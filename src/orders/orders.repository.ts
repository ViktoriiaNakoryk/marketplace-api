import { Inject, Injectable } from '@nestjs/common';
import { PG_POOL } from '../database/database.module';
import type { Queryable } from '../database/queryable';
import { Page, toPage } from '../common/page';

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'completed' | 'cancelled' | 'refunded';

export const ORDER_STATUSES: OrderStatus[] = ['pending', 'paid', 'shipped', 'completed', 'cancelled', 'refunded'];

export type StatusChange = {
    orderId: number;
    buyerId: number;
    status: OrderStatus;
    previousStatus: OrderStatus;
};

export type NewOrder = {
    buyerId: number;
    items: { productId: number; quantity: number }[];
};

export type OrderItemView = {
    productId: number;
    name: string;
    quantity: number;
    unitPrice: number;
};

export type OrderSummary = {
    id: number;
    buyerId: number;
    status: OrderStatus;
    total: number;
    createdAt: string;
};

export type OrderView = OrderSummary & { items: OrderItemView[] };

function toSummary(row: Record<string, unknown>): OrderSummary {
    return {
        id: Number(row.id),
        buyerId: Number(row.buyerId),
        status: row.status as OrderStatus,
        total: Number(row.total),
        createdAt: (row.createdAt as Date).toISOString(),
    };
}

@Injectable()
export class OrdersRepository {
    constructor(@Inject(PG_POOL) private readonly db: Queryable) {}

    async create(order: NewOrder): Promise<OrderView | null> {
        const { rows } = await this.db.query(
            `WITH input AS (
                 SELECT "productId", quantity
                 FROM jsonb_to_recordset($2::jsonb) AS x("productId" bigint, quantity int)
             ), priced AS (
                 SELECT i."productId", i.quantity, p.price
                 FROM input i JOIN products p ON p.id = i."productId"
             ), created AS (
                 INSERT INTO orders ("buyerId", status, total)
                 SELECT $1::bigint, 'pending', sum(price * quantity) FROM priced
                 HAVING count(*) = (SELECT count(*) FROM input)
                 RETURNING id
             ), items AS (
                 INSERT INTO order_items ("orderId", "productId", quantity, "unitPrice")
                 SELECT created.id, priced."productId", priced.quantity, priced.price
                 FROM created CROSS JOIN priced
             )
             SELECT id FROM created`,
            [order.buyerId, JSON.stringify(order.items)],
        );
        return rows[0] ? this.findById(Number(rows[0].id)) : null;
    }

    async findById(id: number): Promise<OrderView | null> {
        const { rows } = await this.db.query(
            `SELECT o.id, o."buyerId", o.status, o.total, o."createdAt",
                    coalesce(
                        json_agg(json_build_object(
                            'productId', oi."productId",
                            'name', p.name,
                            'quantity', oi.quantity,
                            'unitPrice', oi."unitPrice"
                        ) ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL),
                        '[]'
                    ) AS items
             FROM orders o
             LEFT JOIN order_items oi ON oi."orderId" = o.id
             LEFT JOIN products p ON p.id = oi."productId"
             WHERE o.id = $1
             GROUP BY o.id`,
            [id],
        );
        if (!rows[0]) return null;
        const items = (rows[0].items as OrderItemView[]).map((i) => ({ ...i, productId: Number(i.productId) }));
        return { ...toSummary(rows[0]), items };
    }

    async updateStatus(id: number, status: OrderStatus): Promise<StatusChange | null> {
        const { rows } = await this.db.query(
            `WITH prev AS (SELECT id, status FROM orders WHERE id = $1 FOR UPDATE)
             UPDATE orders o SET status = $2
             FROM prev
             WHERE o.id = prev.id
             RETURNING o.id, o."buyerId", o.status, prev.status AS "previousStatus"`,
            [id, status],
        );
        if (!rows[0]) return null;
        return {
            orderId: Number(rows[0].id),
            buyerId: Number(rows[0].buyerId),
            status: rows[0].status as OrderStatus,
            previousStatus: rows[0].previousStatus as OrderStatus,
        };
    }

    async list(limit = 20, cursor?: string): Promise<Page<OrderSummary>> {
        const { rows } = await this.db.query(
            `SELECT id, "buyerId", status, total, "createdAt" FROM orders
             WHERE ($2::bigint IS NULL OR id > $2::bigint)
             ORDER BY id
             LIMIT $1 + 1`,
            [limit, cursor ?? null],
        );
        return toPage(rows.map(toSummary), limit);
    }
}
