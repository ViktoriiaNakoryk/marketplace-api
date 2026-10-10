import { QueryResult, QueryResultRow } from 'pg';

export interface Queryable {
    query<R extends QueryResultRow = any>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}
