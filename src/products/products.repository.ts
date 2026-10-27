import { Inject, Injectable } from '@nestjs/common';
import { PG_POOL } from '../database/database.module';
import type { Queryable } from '../database/queryable';
import { Page, toPage } from '../common/page';

export type NewProduct = {
    sellerId: number;
    sku: string;
    name: string;
    description: string;
    category: string;
    brand: string;
    price: number;
    stock: number;
};

export type ProductRecord = NewProduct & { id: number };

export type ProductCard = ProductRecord & {
    sellerName: string;
    unitsSold: number;
    ordersCount: number;
    revenue: number;
};

const COLUMNS = `id, "sellerId", sku, name, description, category, brand, price, stock`;

function toProduct(row: Record<string, unknown>): ProductRecord {
    return {
        id: Number(row.id),
        sellerId: Number(row.sellerId),
        sku: row.sku as string,
        name: row.name as string,
        description: row.description as string,
        category: row.category as string,
        brand: row.brand as string,
        price: Number(row.price),
        stock: Number(row.stock),
    };
}

@Injectable()
export class ProductsRepository {
    constructor(@Inject(PG_POOL) private readonly db: Queryable) {}

    async create(p: NewProduct): Promise<ProductRecord> {
        const { rows } = await this.db.query(
            `INSERT INTO products ("sellerId", sku, name, description, category, brand, price, stock)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING ${COLUMNS}`,
            [p.sellerId, p.sku, p.name, p.description, p.category, p.brand, p.price, p.stock],
        );
        return toProduct(rows[0]);
    }

    async findById(id: number): Promise<ProductRecord | null> {
        const { rows } = await this.db.query(`SELECT ${COLUMNS} FROM products WHERE id = $1`, [id]);
        return rows[0] ? toProduct(rows[0]) : null;
    }

    async findCard(id: number): Promise<ProductCard | null> {
        const { rows } = await this.db.query(
            `SELECT p.id, p."sellerId", p.sku, p.name, p.description, p.category, p.brand, p.price, p.stock,
                    u."fullName" AS "sellerName",
                    COALESCE(s.units, 0) AS "unitsSold",
                    COALESCE(s.orders, 0) AS "ordersCount",
                    COALESCE(s.revenue, 0) AS revenue
             FROM products p
             JOIN users u ON u.id = p."sellerId"
             LEFT JOIN LATERAL (
                 SELECT sum(oi.quantity) AS units,
                        count(DISTINCT oi."orderId") AS orders,
                        sum(oi.quantity * oi."unitPrice") AS revenue
                 FROM order_items oi
                 WHERE oi."productId" = p.id
             ) s ON true
             WHERE p.id = $1`,
            [id],
        );
        if (!rows[0]) return null;
        return {
            ...toProduct(rows[0]),
            sellerName: rows[0].sellerName as string,
            unitsSold: Number(rows[0].unitsSold),
            ordersCount: Number(rows[0].ordersCount),
            revenue: Number(rows[0].revenue),
        };
    }

    async list(limit = 20, cursor?: string): Promise<Page<ProductRecord>> {
        const { rows } = await this.db.query(
            `SELECT ${COLUMNS} FROM products
             WHERE ($2::bigint IS NULL OR id > $2::bigint)
             ORDER BY id
             LIMIT $1 + 1`,
            [limit, cursor ?? null],
        );
        return toPage(rows.map(toProduct), limit);
    }
}
