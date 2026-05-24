import type { SQLOutputValue } from 'node:sqlite';

type SqliteRow = Record<string, SQLOutputValue>;

export function asSqliteRow<Row extends object>(
  row: SqliteRow | undefined,
): Row | undefined {
  return row as (SqliteRow & Row) | undefined;
}

export function asSqliteRows<Row extends object>(rows: SqliteRow[]): Row[] {
  return rows as Array<SqliteRow & Row>;
}
