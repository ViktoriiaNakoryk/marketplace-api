import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { Env } from '../config/env.schema';

export const PG_POOL = 'PG_POOL';

@Module({
    providers: [
        {
            provide: PG_POOL,
            inject: [ConfigService],
            useFactory: (config: ConfigService<Env, true>) => {
                const url = new URL(config.get('DB_URL', { infer: true }));
                const passwordFile = config.get('DB_PASSWORD_FILE', { infer: true });

                const pool = new Pool({
                    host: url.hostname,
                    port: Number(url.port),
                    user: url.username,
                    database: url.pathname.slice(1),
                    password: async () => (await readFile(passwordFile, 'utf8')).trim(),
                    max: 5,
                });

                pool.on('error', (e) => {
                    console.log(`[db] сервер закрив idle-зʼєднання (${(e as NodeJS.ErrnoException).code}) — пул відкриє нове, процес живе`);
                });

                return pool;
            },
        },
    ],
    exports: [PG_POOL],
})
export class DatabaseModule {}