import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SupportedEventType } from '../../events/event.types';
import { SqliteService } from '../sqlite.service';

describe('SqliteService', () => {
  let directory: string;
  let previousDbPath: string | undefined;
  let service: SqliteService | undefined;

  beforeEach(() => {
    previousDbPath = process.env.SQLITE_DB_PATH;
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'event-db-schema-'));
    process.env.SQLITE_DB_PATH = path.join(directory, 'database.sqlite');
    service = new SqliteService();
  });

  afterEach(() => {
    service?.onModuleDestroy();

    if (previousDbPath === undefined) {
      delete process.env.SQLITE_DB_PATH;
    } else {
      process.env.SQLITE_DB_PATH = previousDbPath;
    }

    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('initializes the event engine schema and seed stats row', () => {
    const db = service!.connection;
    const tables = db
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `,
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual(
      expect.arrayContaining([
        'dead_letter_events',
        'event_decisions',
        'event_processing_jobs',
        'order_field_versions',
        'order_history',
        'orders',
        'processed_event_keys',
        'raw_incoming_events',
        'stats',
      ]),
    );

    const indexes = db
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'index' AND name LIKE 'idx_%'
          ORDER BY name
        `,
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(indexes).toEqual(
      expect.arrayContaining([
        'idx_event_processing_jobs_lock',
        'idx_event_processing_jobs_status_available_id',
        'idx_raw_incoming_events_event_id',
        'idx_raw_incoming_events_order_id',
      ]),
    );

    const jobColumns = db
      .prepare('PRAGMA table_info(event_processing_jobs)')
      .all()
      .map((row) => (row as { name: string }).name);

    expect(jobColumns).toEqual(
      expect.arrayContaining(['locked_by', 'locked_at']),
    );

    expect(
      db
        .prepare(
          `
            SELECT id, valid_events_count, rejected_events_count, duplicate_events_count
            FROM stats
          `,
        )
        .get(),
    ).toMatchObject({
      id: 1,
      valid_events_count: 0,
      rejected_events_count: 0,
      duplicate_events_count: 0,
    });

    expect(db.prepare('PRAGMA foreign_keys').get()).toMatchObject({
      foreign_keys: 1,
    });
  });

  it('rolls back failed transactions', () => {
    const db = service!.connection;

    expect(() =>
      service!.transaction(() => {
        db.prepare(
          `
            INSERT INTO raw_incoming_events (
              event_id,
              order_id,
              type,
              event_timestamp,
              raw_event_json,
              payload_json,
              received_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
        ).run(
          'evt-rollback',
          'ord-rollback',
          SupportedEventType.OrderCreated,
          1710000000,
          '{}',
          '{}',
          new Date().toISOString(),
        );

        throw new Error('fail the unit of work');
      }),
    ).toThrow('fail the unit of work');

    expect(
      db
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM raw_incoming_events
            WHERE event_id = ?
          `,
        )
        .get('evt-rollback'),
    ).toMatchObject({ count: 0 });
  });
});
