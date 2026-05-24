import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DatabaseSync as DatabaseSyncInstance } from 'node:sqlite';
import { databaseSchemaSql } from './schema';

const sqlite = process.getBuiltinModule('node:sqlite') as
  | typeof import('node:sqlite')
  | undefined;

if (!sqlite) {
  throw new Error('The node:sqlite module requires Node.js 24 or newer.');
}

const { DatabaseSync } = sqlite;

@Injectable()
export class SqliteService implements OnModuleDestroy {
  private readonly database: DatabaseSyncInstance;
  readonly path: string;

  constructor() {
    const configuredPath = process.env.SQLITE_DB_PATH ?? 'data/app.sqlite';
    this.path =
      configuredPath === ':memory:' ? configuredPath : resolve(configuredPath);

    if (this.path !== ':memory:') {
      mkdirSync(dirname(this.path), { recursive: true });
    }

    this.database = new DatabaseSync(this.path, {
      timeout: 5000,
    });

    this.configureConnection();
    this.initializeSchema();
    this.runAdditiveMigrations();
  }

  get connection(): DatabaseSyncInstance {
    return this.database;
  }

  transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN');

    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  onModuleDestroy(): void {
    this.database.close();
  }

  private configureConnection(): void {
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
    `);
  }

  private initializeSchema(): void {
    this.database.exec(databaseSchemaSql);
  }

  private runAdditiveMigrations(): void {
    this.addColumnIfMissing('event_processing_jobs', 'locked_by', 'TEXT');
    this.addColumnIfMissing('event_processing_jobs', 'locked_at', 'TEXT');
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS idx_event_processing_jobs_lock
        ON event_processing_jobs (locked_by, locked_at);
    `);
  }

  private addColumnIfMissing(
    tableName: string,
    columnName: string,
    definition: string,
  ): void {
    const columns = this.database
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name: string }>;

    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    this.database.exec(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`,
    );
  }
}
