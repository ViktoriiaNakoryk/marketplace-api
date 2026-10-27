import 'reflect-metadata';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { Pool } from 'pg';
import { hashPassword } from '../auth/password';
import { AppDataSource } from '../data-source';
import type { Role } from '../users/users.repository';
import { demoTag, sleep } from './redis-demo';

export type HttpResult = { status: number; body: any };

export const PASSWORD = 'correct horse battery staple';

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = createServer();
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address() as { port: number };
            srv.close(() => resolve(port));
        });
    });
}

export class AuthDemo {
    private readonly userIds: number[] = [];
    private readonly tag = demoTag();

    private constructor(
        readonly pool: Pool,
        private readonly child: ChildProcess,
        readonly baseUrl: string,
    ) {}

    static async start(): Promise<AuthDemo> {
        process.env.DATABASE_URL ??= process.env.DB_URL;
        if (!process.env.DATABASE_URL) {
            throw new Error('DATABASE_URL is not set (bash scripts/with-secrets.sh dev … або export DATABASE_URL=…)');
        }
        await AppDataSource.initialize();
        await AppDataSource.runMigrations();
        await AppDataSource.destroy();

        const port = await freePort();
        const child = spawn(process.execPath, [join(__dirname, '..', 'main.js')], {
            env: { ...process.env, PORT: String(port), DB_URL: process.env.DATABASE_URL, RATE_LIMIT_PER_MINUTE: '100000' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const kill = () => child.exitCode === null && child.kill('SIGTERM');
        process.once('exit', kill);
        for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => process.exit(130));

        let output = '';
        const collect = (chunk: Buffer) => {
            const text = chunk.toString();
            output += text;
            for (const line of text.split('\n')) if (line.includes('[auth]')) console.log(`# app: ${line.trim()}`);
        };
        child.stdout!.on('data', collect);
        child.stderr!.on('data', collect);

        const baseUrl = `http://127.0.0.1:${port}`;
        const deadline = Date.now() + 30_000;
        for (;;) {
            if (child.exitCode !== null) throw new Error(`app exited with ${child.exitCode}:\n${output}`);
            const ok = await fetch(`${baseUrl}/health`).then((r) => r.ok, () => false);
            if (ok) break;
            if (Date.now() > deadline) throw new Error(`app did not become healthy in 30s:\n${output}`);
            await sleep(200);
        }
        console.log(`# app started on ${baseUrl} (pid ${child.pid})`);
        return new AuthDemo(new Pool({ connectionString: process.env.DATABASE_URL, max: 3 }), child, baseUrl);
    }

    async givenUser(role: Role): Promise<{ id: number; email: string }> {
        const email = `auth-${role}-${this.userIds.length}-${this.tag}@demo.local`;
        const { rows } = await this.pool.query(
            `INSERT INTO users (email, "fullName", role, balance, password_hash) VALUES ($1, $2, $3, 1000000, $4) RETURNING id`,
            [email, `Auth demo ${role}`, role, await hashPassword(PASSWORD)],
        );
        const id = Number(rows[0].id);
        this.userIds.push(id);
        return { id, email };
    }

    async call(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<HttpResult> {
        const headers: Record<string, string> = { ...opts.headers };
        if (opts.token) headers.authorization = `Bearer ${opts.token}`;
        if (opts.body !== undefined) headers['content-type'] = 'application/json';
        const res = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers,
            body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        });
        const text = await res.text();
        let body: any = text;
        try {
            body = text ? JSON.parse(text) : null;
        } catch {
            body = text;
        }
        return { status: res.status, body };
    }

    login(email: string): Promise<HttpResult> {
        return this.call('POST', '/auth/login', { body: { email, password: PASSWORD } });
    }

    refresh(refreshToken: string): Promise<HttpResult> {
        return this.call('POST', '/auth/refresh', { body: { refreshToken } });
    }

    async cleanup(): Promise<void> {
        const ids = this.userIds;
        if (ids.length) {
            const orders = await this.pool.query(`SELECT id FROM orders WHERE "buyerId" = ANY($1::bigint[])`, [ids]);
            const orderIds = orders.rows.map((r) => String(r.id));
            await this.pool.query(`DELETE FROM outbox WHERE aggregatetype = 'order' AND aggregateid = ANY($1::text[])`, [orderIds]);
            await this.pool.query(`DELETE FROM orders WHERE "buyerId" = ANY($1::bigint[])`, [ids]);
            await this.pool.query(`DELETE FROM products WHERE "sellerId" = ANY($1::bigint[])`, [ids]);
            await this.pool.query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [ids]);
        }
        await this.pool.query(`DELETE FROM access_token_denylist WHERE expires_at < now()`);
        await this.pool.end();
        if (this.child.exitCode === null) {
            this.child.kill('SIGTERM');
            await new Promise((r) => this.child.once('exit', r));
        }
    }
}

export function jtiOf(token: string): string {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).jti;
}
