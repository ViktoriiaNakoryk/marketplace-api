import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgres } from './postgres';

declare global {
    var __PG_CONTAINER__: StartedPostgreSqlContainer | undefined;
}

export default async function globalSetup(): Promise<void> {
    const container = await startPostgres();
    globalThis.__PG_CONTAINER__ = container;
    process.env.DB_URL = container.getConnectionUri();
}
