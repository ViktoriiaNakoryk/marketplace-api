import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export type Page<T> = { items: T[]; next_cursor: string | null };

export class PageQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;

    @IsOptional()
    @Matches(/^\d+$/)
    cursor?: string;
}

export function toPage<T extends { id: number }>(rows: T[], limit: number): Page<T> {
    const items = rows.slice(0, limit);
    const next_cursor = rows.length > limit ? String(items[items.length - 1].id) : null;
    return { items, next_cursor };
}
