import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';
import {
  ProcessingStatus,
  SupportedEventType,
} from '../../events/types/event.types';
import { DatabaseService } from '../database.service';
import { EngineStatsEntity, RawIncomingEventEntity } from '../entities';
import { createTypeOrmOptions } from '../typeorm.config';

describe('DatabaseService', () => {
  let directory: string;
  let previousDbPath: string | undefined;
  let dataSource: DataSource;
  let service: DatabaseService;

  beforeEach(async () => {
    previousDbPath = process.env.SQLITE_DB_PATH;
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'event-db-schema-'));
    process.env.SQLITE_DB_PATH = path.join(directory, 'database.sqlite');
    dataSource = new DataSource(createTypeOrmOptions() as DataSourceOptions);
    await dataSource.initialize();
    service = new DatabaseService(dataSource);
  });

  afterEach(async () => {
    await dataSource.destroy();

    if (previousDbPath === undefined) {
      delete process.env.SQLITE_DB_PATH;
    } else {
      process.env.SQLITE_DB_PATH = previousDbPath;
    }

    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('creates exactly the documented schema and seeds singleton stats', async () => {
    expect(await dataSource.showMigrations()).toBe(false);
    expect(dataSource.hasMetadata(RawIncomingEventEntity)).toBe(true);
    const tables = (
      (await dataSource.query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'migrations' ORDER BY name",
      )) as Array<{ name: string }>
    ).map(({ name }) => name);
    expect(tables).toEqual([
      'dead_letter_events',
      'event_decisions',
      'order_field_versions',
      'orders',
      'processed_event_keys',
      'raw_incoming_events',
      'stats',
    ]);
    const columnNames = async (table: string): Promise<string[]> =>
      (
        (await dataSource.query(`PRAGMA table_info(${table})`)) as Array<{
          name: string;
        }>
      ).map(({ name }) => name);
    await expect(columnNames('raw_incoming_events')).resolves.toEqual([
      'id',
      'event_id',
      'order_id',
      'type',
      'event_timestamp',
      'raw_event_json',
      'received_at',
      'processing_status',
      'available_at',
      'attempts',
      'last_error_message',
    ]);
    await expect(columnNames('event_decisions')).resolves.toEqual([
      'id',
      'raw_incoming_event_id',
      'decision',
      'reason_code',
      'reason_message',
      'from_status',
      'to_status',
      'changed_fields_json',
      'skipped_fields_json',
      'processing_time_ms',
      'created_at',
    ]);
    await expect(columnNames('stats')).resolves.toEqual([
      'id',
      'valid_events_count',
      'rejected_events_count',
      'duplicate_events_count',
      'processed_events_count',
      'total_processing_time_ms',
      'updated_at',
    ]);
    await expect(
      dataSource.getRepository(EngineStatsEntity).findOneByOrFail({ id: 1 }),
    ).resolves.toMatchObject({
      validEventsCount: 0,
      rejectedEventsCount: 0,
      duplicateEventsCount: 0,
    });
  });

  it('rolls back failed repository transactions', async () => {
    await expect(
      service.transaction(async (manager) => {
        await manager.getRepository(RawIncomingEventEntity).insert({
          eventId: 'evt-rollback',
          orderId: 'ord-rollback',
          type: SupportedEventType.OrderCreated,
          eventTimestamp: 1710000000,
          rawEventJson: '{}',
          receivedAt: new Date().toISOString(),
          processingStatus: ProcessingStatus.Pending,
          availableAt: new Date().toISOString(),
          attempts: 0,
          lastErrorMessage: null,
        });

        throw new Error('fail the unit of work');
      }),
    ).rejects.toThrow('fail the unit of work');

    await expect(
      dataSource.getRepository(RawIncomingEventEntity).countBy({
        eventId: 'evt-rollback',
      }),
    ).resolves.toBe(0);
  });

  it('repairs legacy databases that already recorded the first migration', async () => {
    await dataSource.destroy();

    const databasePath = process.env.SQLITE_DB_PATH;
    if (databasePath === undefined) {
      throw new Error('SQLITE_DB_PATH is not configured for the test');
    }

    removeSqliteFiles(databasePath);
    await seedLegacyDatabase(databasePath);

    dataSource = new DataSource(createTypeOrmOptions() as DataSourceOptions);
    await dataSource.initialize();
    service = new DatabaseService(dataSource);

    await expect(dataSource.showMigrations()).resolves.toBe(false);
    await expect(
      dataSource.getRepository(RawIncomingEventEntity).countBy({
        processingStatus: ProcessingStatus.Pending,
      }),
    ).resolves.toBe(1);

    await expect(
      columnNames(dataSource, 'raw_incoming_events'),
    ).resolves.toEqual([
      'id',
      'event_id',
      'order_id',
      'type',
      'event_timestamp',
      'raw_event_json',
      'payload_json',
      'received_at',
      'processing_status',
      'available_at',
      'attempts',
      'last_error_message',
    ]);
    await expect(columnNames(dataSource, 'event_decisions')).resolves.toEqual([
      'id',
      'raw_incoming_event_id',
      'event_processing_job_id',
      'event_id',
      'order_id',
      'type',
      'timestamp',
      'decision',
      'reason_code',
      'reason_message',
      'details_json',
      'processing_time_ms',
      'created_at',
      'from_status',
      'to_status',
      'changed_fields_json',
      'skipped_fields_json',
    ]);
    await expect(
      dataSource.query(
        'SELECT processing_status, available_at, attempts FROM raw_incoming_events WHERE event_id = ?',
        ['evt-legacy'],
      ),
    ).resolves.toEqual([
      {
        processing_status: ProcessingStatus.Pending,
        available_at: '2026-05-25T12:00:00.000Z',
        attempts: 0,
      },
    ]);
  });
});

async function columnNames(
  dataSource: DataSource,
  table: string,
): Promise<string[]> {
  return (
    (await dataSource.query(`PRAGMA table_info(${table})`)) as Array<{
      name: string;
    }>
  ).map(({ name }) => name);
}

function removeSqliteFiles(databasePath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

async function seedLegacyDatabase(databasePath: string): Promise<void> {
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: databasePath,
    synchronize: false,
    migrationsRun: false,
  } as DataSourceOptions);
  await dataSource.initialize();

  try {
    for (const statement of [
      `CREATE TABLE migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        timestamp BIGINT NOT NULL,
        name VARCHAR NOT NULL
      )`,
      `INSERT INTO migrations (timestamp, name)
      VALUES (1760000000000, 'CreateEventEngineSchema1760000000000')`,
      `CREATE TABLE raw_incoming_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT,
        order_id TEXT,
        type TEXT,
        event_timestamp INTEGER,
        raw_event_json TEXT NOT NULL,
        payload_json TEXT,
        received_at TEXT NOT NULL
      )`,
      `INSERT INTO raw_incoming_events (
        event_id,
        order_id,
        type,
        event_timestamp,
        raw_event_json,
        payload_json,
        received_at
      )
      VALUES (
        'evt-legacy',
        'ord-legacy',
        'ORDER_CREATED',
        1710000000,
        '{}',
        '{}',
        '2026-05-25T12:00:00.000Z'
      )`,
      `CREATE TABLE event_decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_incoming_event_id INTEGER NOT NULL,
        event_processing_job_id INTEGER NOT NULL,
        event_id TEXT,
        order_id TEXT,
        type TEXT,
        timestamp INTEGER,
        decision TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        reason_message TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        processing_time_ms INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
    ]) {
      await dataSource.query(statement);
    }
  } finally {
    await dataSource.destroy();
  }
}
