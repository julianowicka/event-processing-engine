import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEventEngineSchema1760000000000 implements MigrationInterface {
  name = 'CreateEventEngineSchema1760000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('PRAGMA foreign_keys = ON');

    for (const statement of [
      `CREATE TABLE IF NOT EXISTS raw_incoming_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT,
        order_id TEXT,
        type TEXT,
        event_timestamp INTEGER,
        raw_event_json TEXT NOT NULL,
        received_at TEXT NOT NULL,
        processing_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
          processing_status IN ('PENDING', 'RETRY', 'DONE', 'DEAD_LETTERED')
        ),
        available_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        last_error_message TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS processed_event_keys (
        event_id TEXT PRIMARY KEY,
        first_raw_incoming_event_id INTEGER NOT NULL,
        FOREIGN KEY (first_raw_incoming_event_id) REFERENCES raw_incoming_events(id)
      )`,
      `CREATE TABLE IF NOT EXISTS orders (
        order_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (
          status IN ('CREATED', 'PAID', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED')
        ),
        amount_minor INTEGER,
        currency TEXT,
        paid_amount_minor INTEGER NOT NULL DEFAULT 0,
        refunded_amount_minor INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS order_field_versions (
        order_id TEXT NOT NULL,
        field_name TEXT NOT NULL CHECK (
          field_name IN ('status', 'amountMinor', 'currency')
        ),
        last_event_timestamp INTEGER NOT NULL,
        last_event_id TEXT NOT NULL,
        PRIMARY KEY (order_id, field_name),
        FOREIGN KEY (order_id) REFERENCES orders(order_id)
      )`,
      `CREATE TABLE IF NOT EXISTS event_decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_incoming_event_id INTEGER NOT NULL UNIQUE,
        decision TEXT NOT NULL CHECK (
          decision IN ('ACCEPTED', 'PARTIALLY_APPLIED', 'REJECTED', 'DUPLICATE', 'FAILED')
        ),
        reason_code TEXT NOT NULL,
        reason_message TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT,
        changed_fields_json TEXT NOT NULL DEFAULT '{}',
        skipped_fields_json TEXT NOT NULL DEFAULT '{}',
        processing_time_ms INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (raw_incoming_event_id) REFERENCES raw_incoming_events(id)
      )`,
      `CREATE TABLE IF NOT EXISTS stats (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        valid_events_count INTEGER NOT NULL DEFAULT 0,
        rejected_events_count INTEGER NOT NULL DEFAULT 0,
        duplicate_events_count INTEGER NOT NULL DEFAULT 0,
        processed_events_count INTEGER NOT NULL DEFAULT 0,
        total_processing_time_ms INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS dead_letter_events (
        raw_incoming_event_id INTEGER PRIMARY KEY,
        error_message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (raw_incoming_event_id) REFERENCES raw_incoming_events(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_raw_processing_queue
        ON raw_incoming_events (processing_status, available_at, id)`,
      `CREATE INDEX IF NOT EXISTS idx_raw_order_id
        ON raw_incoming_events (order_id, id)`,
      `CREATE INDEX IF NOT EXISTS idx_raw_event_id
        ON raw_incoming_events (event_id, id)`,
      `CREATE INDEX IF NOT EXISTS idx_event_decisions_created
        ON event_decisions (created_at, id)`,
    ]) {
      await queryRunner.query(statement);
    }

    await queryRunner.query(
      "INSERT OR IGNORE INTO stats (id, updated_at) VALUES (1, datetime('now'))",
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'dead_letter_events',
      'stats',
      'event_decisions',
      'order_field_versions',
      'orders',
      'processed_event_keys',
      'raw_incoming_events',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${table}`);
    }
  }
}
