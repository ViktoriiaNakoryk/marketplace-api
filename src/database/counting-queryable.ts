import type { QueryResult, QueryResultRow } from 'pg';
import type { Queryable } from './queryable';

export class CountingQueryable implements Queryable {
    calls = 0;

    constructor(private readonly inner: Queryable) {}

    query<R extends QueryResultRow = any>(text: string, values?: unknown[]): Promise<QueryResult<R>> {
        this.calls++;
        return this.inner.query<R>(text, values);
    }
}
