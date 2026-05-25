import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RepairLegacyEventEngineSchema1760000001000 implements MigrationInterface {
  name = 'RepairLegacyEventEngineSchema1760000001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const rawColumnNames = await this.getColumnNames(
      queryRunner,
      'raw_incoming_events',
    );

    if (!rawColumnNames.has('processing_status')) {
      await queryRunner.query(`
        ALTER TABLE raw_incoming_events
        ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
          processing_status IN ('PENDING', 'RETRY', 'DONE', 'DEAD_LETTERED')
        )
      `);
    }

    if (!rawColumnNames.has('available_at')) {
      await queryRunner.query(`
        ALTER TABLE raw_incoming_events
        ADD COLUMN available_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'
      `);
      await queryRunner.query(`
        UPDATE raw_incoming_events
        SET available_at = received_at
        WHERE available_at = '1970-01-01T00:00:00.000Z'
      `);
    }

    if (!rawColumnNames.has('attempts')) {
      await queryRunner.query(`
        ALTER TABLE raw_incoming_events
        ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
      `);
    }

    if (!rawColumnNames.has('last_error_message')) {
      await queryRunner.query(`
        ALTER TABLE raw_incoming_events
        ADD COLUMN last_error_message TEXT
      `);
    }

    const decisionColumnNames = await this.getColumnNames(
      queryRunner,
      'event_decisions',
    );

    if (!decisionColumnNames.has('from_status')) {
      await queryRunner.query(`
        ALTER TABLE event_decisions
        ADD COLUMN from_status TEXT
      `);
    }

    if (!decisionColumnNames.has('to_status')) {
      await queryRunner.query(`
        ALTER TABLE event_decisions
        ADD COLUMN to_status TEXT
      `);
    }

    if (!decisionColumnNames.has('changed_fields_json')) {
      await queryRunner.query(`
        ALTER TABLE event_decisions
        ADD COLUMN changed_fields_json TEXT NOT NULL DEFAULT '{}'
      `);
      if (decisionColumnNames.has('details_json')) {
        await queryRunner.query(`
          UPDATE event_decisions
          SET changed_fields_json = details_json
          WHERE details_json IS NOT NULL
        `);
      }
    }

    if (!decisionColumnNames.has('skipped_fields_json')) {
      await queryRunner.query(`
        ALTER TABLE event_decisions
        ADD COLUMN skipped_fields_json TEXT NOT NULL DEFAULT '{}'
      `);
    }

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_raw_processing_queue
      ON raw_incoming_events (processing_status, available_at, id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_raw_order_id
      ON raw_incoming_events (order_id, id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_raw_event_id
      ON raw_incoming_events (event_id, id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_event_decisions_created
      ON event_decisions (created_at, id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_raw_processing_queue');
    await queryRunner.query('DROP INDEX IF EXISTS idx_raw_order_id');
    await queryRunner.query('DROP INDEX IF EXISTS idx_raw_event_id');
    await queryRunner.query('DROP INDEX IF EXISTS idx_event_decisions_created');

    const rawColumnNames = await this.getColumnNames(
      queryRunner,
      'raw_incoming_events',
    );

    for (const columnName of [
      'last_error_message',
      'attempts',
      'available_at',
      'processing_status',
    ]) {
      if (rawColumnNames.has(columnName)) {
        await queryRunner.query(
          `ALTER TABLE raw_incoming_events DROP COLUMN ${columnName}`,
        );
      }
    }

    const decisionColumnNames = await this.getColumnNames(
      queryRunner,
      'event_decisions',
    );

    for (const columnName of [
      'skipped_fields_json',
      'changed_fields_json',
      'to_status',
      'from_status',
    ]) {
      if (decisionColumnNames.has(columnName)) {
        await queryRunner.query(
          `ALTER TABLE event_decisions DROP COLUMN ${columnName}`,
        );
      }
    }
  }

  private async getColumnNames(
    queryRunner: QueryRunner,
    tableName: string,
  ): Promise<Set<string>> {
    const rows = (await queryRunner.query(
      `PRAGMA table_info(${tableName})`,
    )) as Array<{ name: string }> | undefined;

    return new Set((rows ?? []).map(({ name }) => name));
  }
}
