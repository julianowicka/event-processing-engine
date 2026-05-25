import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveDeadLetterQueue1760000000001 implements MigrationInterface {
  name = 'RemoveDeadLetterQueue1760000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS dead_letter_events');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS dead_letter_events (
        raw_incoming_event_id INTEGER PRIMARY KEY,
        error_message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (raw_incoming_event_id) REFERENCES raw_incoming_events(id)
      )`,
    );
  }
}
