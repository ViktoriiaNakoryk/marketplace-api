import { Client } from 'pg';

export function useRollbackTransaction(): () => Client {
    let client: Client;

    beforeAll(async () => {
        client = new Client({ connectionString: process.env.DB_URL });
        await client.connect();
    });
    beforeEach(() => client.query('BEGIN'));
    afterEach(() => client.query('ROLLBACK'));
    afterAll(() => client.end());

    return () => client;
}
