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
