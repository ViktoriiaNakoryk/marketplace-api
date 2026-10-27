import { generateKeyPairSync, randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgres } from './postgres';

declare global {
    var __PG_CONTAINER__: StartedPostgreSqlContainer | undefined;
}

export default async function globalSetup(): Promise<void> {
    const container = await startPostgres();
    globalThis.__PG_CONTAINER__ = container;
    process.env.DB_URL = container.getConnectionUri();

    const keys = generateKeyPairSync('ec', {
        namedCurve: 'P-256',
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    process.env.JWT_KID = 'test';
    process.env.JWT_PRIVATE_KEY = Buffer.from(keys.privateKey).toString('base64');
    process.env.JWT_PUBLIC_KEY = Buffer.from(keys.publicKey).toString('base64');
    process.env.REFRESH_TOKEN_PEPPER = randomBytes(32).toString('base64url');
}
