import { Controller, Get, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

@Controller('health')
export class HealthController {
    constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

    @Get()
    health() {
        return { status: 'ok', uptime: process.uptime() };
    }

    @Get('db')
    async db() {
        const r = await this.pool.query('SELECT current_user, now()');
        return { db: 'ok', ...r.rows[0] };
    }
}