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
      await dataSource.query<Array<{ name: string }>>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'migrations' ORDER BY name",
      )
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
        await dataSource.query<Array<{ name: string }>>(
          `PRAGMA table_info(${table})`,
        )
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
});
