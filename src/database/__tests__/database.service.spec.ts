import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { SupportedEventType } from '../../events/event.types';
import { DatabaseService } from '../database.service';
import {
  EngineStatsEntity,
  EventProcessingJobEntity,
  RawIncomingEventEntity,
} from '../entities';
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

  it('runs migrations and seeds the singleton stats entity', async () => {
    expect(await dataSource.showMigrations()).toBe(false);
    expect(dataSource.hasMetadata(RawIncomingEventEntity)).toBe(true);
    expect(dataSource.hasMetadata(EventProcessingJobEntity)).toBe(true);
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
          payloadJson: '{}',
          receivedAt: new Date().toISOString(),
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
