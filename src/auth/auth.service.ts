import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Pool, PoolClient } from 'pg';
import { Env } from '../config/env.schema';
import { PG_POOL } from '../database/database.module';
import type { Queryable } from '../database/queryable';
import type { Role } from '../users/users.repository';
import { verifyPassword } from './password';
import { ACCESS_TTL_SEC, type AccessClaims, TokenService } from './token.service';

export const REFRESH_TTL_SEC = 30 * 24 * 3600;

export type TokenPair = {
    accessToken: string;
    refreshToken: string;
    tokenType: 'Bearer';
    expiresIn: number;
};

@Injectable()
export class AuthService {
    private readonly pepper: string;

    constructor(
        @Inject(PG_POOL) private readonly pool: Pool,
        private readonly tokens: TokenService,
        config: ConfigService<Env, true>,
    ) {
        this.pepper = config.get('REFRESH_TOKEN_PEPPER', { infer: true });
    }

    hashRefresh(token: string): string {
        return createHmac('sha256', this.pepper).update(token).digest('hex');
    }

    async login(email: string, password: string): Promise<TokenPair> {
        const { rows } = await this.pool.query(`SELECT id, role, password_hash FROM users WHERE email = $1`, [email]);
        const ok = await verifyPassword(password, rows[0]?.password_hash ?? null);
        if (!rows[0] || !ok) throw new UnauthorizedException('Invalid email or password');
        return this.issue(this.pool, { id: Number(rows[0].id), role: rows[0].role as Role }, randomUUID(), null);
    }

    async refresh(refreshToken: string): Promise<TokenPair> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const { rows } = await client.query(
                `SELECT rt.id, rt.user_id, rt.family_id, rt.used_at, rt.revoked_at, rt.expires_at <= now() AS expired, u.role
                 FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
                 WHERE rt.token_hash = $1
                 FOR UPDATE OF rt`,
                [this.hashRefresh(refreshToken)],
            );
            const row = rows[0];
            if (!row || row.revoked_at || row.expired) {
                await client.query('ROLLBACK');
                throw new UnauthorizedException('Refresh token is not valid');
            }
            if (row.used_at) {
                const revoked = await this.revokeFamily(client, row.family_id);
                await client.query('COMMIT');
                console.warn(
                    `[auth] refresh token reuse detected: family=${row.family_id} user=${row.user_id} token_id=${row.id} → revoked ${revoked} token(s) of the family`,
                );
                throw new UnauthorizedException('Refresh token reuse detected, session revoked');
            }
            await client.query(`UPDATE refresh_tokens SET used_at = now() WHERE id = $1`, [row.id]);
            const pair = await this.issue(client, { id: Number(row.user_id), role: row.role as Role }, row.family_id, row.id);
            await client.query('COMMIT');
            return pair;
        } catch (e) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw e;
        } finally {
            client.release();
        }
    }

    async logout(claims: AccessClaims): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await this.revokeFamily(client, claims.sid);
            await client.query(
                `INSERT INTO access_token_denylist (jti, expires_at) VALUES ($1, to_timestamp($2)) ON CONFLICT (jti) DO NOTHING`,
                [claims.jti, claims.exp],
            );
            await client.query(`DELETE FROM access_token_denylist WHERE expires_at < now()`);
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw e;
        } finally {
            client.release();
        }
    }

    async isRevoked(claims: AccessClaims): Promise<boolean> {
        const { rows } = await this.pool.query(
            `SELECT EXISTS (SELECT 1 FROM access_token_denylist WHERE jti = $1 AND expires_at > now())
                 OR EXISTS (SELECT 1 FROM refresh_tokens WHERE family_id = $2 AND revoked_at IS NOT NULL) AS revoked`,
            [claims.jti, claims.sid],
        );
        return rows[0].revoked === true;
    }

    private async revokeFamily(client: PoolClient, familyId: string): Promise<number> {
        const { rowCount } = await client.query(
            `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`,
            [familyId],
        );
        return rowCount ?? 0;
    }

    private async issue(
        db: Queryable,
        user: { id: number; role: Role },
        familyId: string,
        parentId: string | null,
    ): Promise<TokenPair> {
        const refreshToken = randomBytes(32).toString('base64url');
        await db.query(
            `INSERT INTO refresh_tokens (id, user_id, family_id, parent_id, token_hash, expires_at)
             VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
            [randomUUID(), user.id, familyId, parentId, this.hashRefresh(refreshToken), REFRESH_TTL_SEC],
        );
        const access = this.tokens.sign(user, familyId);
        return { accessToken: access.token, refreshToken, tokenType: 'Bearer', expiresIn: ACCESS_TTL_SEC };
    }
}
