import { Inject, Injectable } from '@nestjs/common';
import { PG_POOL } from '../database/database.module';
import type { Queryable } from '../database/queryable';

export type Role = 'buyer' | 'seller' | 'admin';

export type NewUser = {
    email: string;
    fullName: string;
    role: Role;
    balance: number;
};

export type UserRecord = NewUser & { id: number };

const COLUMNS = `id, email, "fullName", role, balance`;

function toUser(row: Record<string, unknown>): UserRecord {
    return {
        id: Number(row.id),
        email: row.email as string,
        fullName: row.fullName as string,
        role: row.role as Role,
        balance: Number(row.balance),
    };
}

@Injectable()
export class UsersRepository {
    constructor(@Inject(PG_POOL) private readonly db: Queryable) {}

    async create(user: NewUser): Promise<UserRecord> {
        const { rows } = await this.db.query(
            `INSERT INTO users (email, "fullName", role, balance) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
            [user.email, user.fullName, user.role, user.balance],
        );
        return toUser(rows[0]);
    }

    async findById(id: number): Promise<UserRecord | null> {
        const { rows } = await this.db.query(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
        return rows[0] ? toUser(rows[0]) : null;
    }
}
