import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { databaseEntities } from './entities';
import { CreateEventEngineSchema1760000000000 } from './migrations/1760000000000-create-event-engine-schema';

export function getDatabasePath(): string {
  const configuredPath = process.env.SQLITE_DB_PATH ?? 'data/app.sqlite';
  return configuredPath === ':memory:'
    ? configuredPath
    : resolve(configuredPath);
}

export function createTypeOrmOptions(): TypeOrmModuleOptions {
  const database = getDatabasePath();

  if (database !== ':memory:') {
    mkdirSync(dirname(database), { recursive: true });
  }

  return {
    type: 'better-sqlite3',
    database,
    timeout: 5000,
    enableWAL: database !== ':memory:',
    entities: databaseEntities,
    migrations: [CreateEventEngineSchema1760000000000],
    migrationsRun: true,
    synchronize: false,
    logging: false,
  };
}
