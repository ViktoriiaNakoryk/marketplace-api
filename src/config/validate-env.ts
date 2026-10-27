import { existsSync } from 'node:fs';
import { validate } from './env.schema';

if (existsSync('.env')) process.loadEnvFile('.env');
process.env.DB_URL ??= process.env.DATABASE_URL;

try {
    validate(process.env);
} catch (e) {
    console.error((e as Error).message);
    process.exit(1);
}
