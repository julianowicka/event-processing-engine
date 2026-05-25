import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableCheck,
  TableForeignKey,
  TableIndex,
} from 'typeorm';
import {
  EngineDecision,
  JobStatus,
  OrderStatus,
  ReasonCode,
} from '../../events/event.types';
import { EngineStatsEntity } from '../entities';

const values = (items: readonly string[]): string =>
  items.map((item) => `'${item}'`).join(', ');

export class CreateEventEngineSchema1760000000000 implements MigrationInterface {
  name = 'CreateEventEngineSchema1760000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.dropApplicationTables(queryRunner);

    await queryRunner.createTable(
      new Table({
        name: 'raw_incoming_events',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'event_id', type: 'text', isNullable: true },
          { name: 'order_id', type: 'text', isNullable: true },
          { name: 'type', type: 'text', isNullable: true },
          { name: 'event_timestamp', type: 'integer', isNullable: true },
          { name: 'raw_event_json', type: 'text' },
          { name: 'payload_json', type: 'text', isNullable: true },
          { name: 'received_at', type: 'text' },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'event_processing_jobs',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'raw_incoming_event_id', type: 'integer', isUnique: true },
          { name: 'status', type: 'text' },
          { name: 'available_at', type: 'text' },
          { name: 'attempts', type: 'integer', default: 0 },
          { name: 'last_error_message', type: 'text', isNullable: true },
          { name: 'last_decision_id', type: 'integer', isNullable: true },
          { name: 'last_reason_code', type: 'text', isNullable: true },
          { name: 'locked_by', type: 'text', isNullable: true },
          { name: 'locked_at', type: 'text', isNullable: true },
          { name: 'created_at', type: 'text' },
          { name: 'updated_at', type: 'text' },
        ],
        checks: [
          new TableCheck({
            name: 'chk_event_processing_jobs_status',
            expression: `status IN (${values(Object.values(JobStatus))})`,
          }),
          new TableCheck({
            name: 'chk_event_processing_jobs_attempts',
            expression: 'attempts >= 0',
          }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'fk_jobs_raw_event',
            columnNames: ['raw_incoming_event_id'],
            referencedTableName: 'raw_incoming_events',
            referencedColumnNames: ['id'],
          }),
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'processed_event_keys',
        columns: [
          { name: 'event_id', type: 'text', isPrimary: true },
          { name: 'first_raw_incoming_event_id', type: 'integer' },
          { name: 'order_id', type: 'text', isNullable: true },
          { name: 'first_seen_at', type: 'text' },
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'fk_processed_event_key_raw_event',
            columnNames: ['first_raw_incoming_event_id'],
            referencedTableName: 'raw_incoming_events',
            referencedColumnNames: ['id'],
          }),
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'orders',
        columns: [
          { name: 'order_id', type: 'text', isPrimary: true },
          { name: 'status', type: 'text' },
          { name: 'amount_minor', type: 'integer', isNullable: true },
          { name: 'currency', type: 'text', isNullable: true },
          { name: 'paid_amount_minor', type: 'integer', default: 0 },
          { name: 'refunded_amount_minor', type: 'integer', default: 0 },
          { name: 'version', type: 'integer', default: 1 },
          { name: 'max_accepted_event_timestamp', type: 'integer' },
          { name: 'last_accepted_event_id', type: 'text' },
          { name: 'created_at', type: 'text' },
          { name: 'updated_at', type: 'text' },
        ],
        checks: [
          new TableCheck({
            name: 'chk_orders_status',
            expression: `status IN (${values(Object.values(OrderStatus))})`,
          }),
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'order_field_versions',
        columns: [
          { name: 'order_id', type: 'text', isPrimary: true },
          { name: 'field_name', type: 'text', isPrimary: true },
          { name: 'last_event_timestamp', type: 'integer' },
          { name: 'last_event_id', type: 'text' },
          { name: 'updated_at', type: 'text' },
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'fk_order_field_versions_order',
            columnNames: ['order_id'],
            referencedTableName: 'orders',
            referencedColumnNames: ['order_id'],
          }),
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'order_history',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'order_id', type: 'text' },
          { name: 'event_id', type: 'text' },
          { name: 'event_type', type: 'text' },
          { name: 'event_timestamp', type: 'integer' },
          { name: 'processed_at', type: 'text' },
          { name: 'from_status', type: 'text', isNullable: true },
          { name: 'to_status', type: 'text' },
          { name: 'changed_fields_json', type: 'text', default: "'{}'" },
          { name: 'skipped_fields_json', type: 'text', default: "'{}'" },
          { name: 'decision', type: 'text' },
          { name: 'reason_code', type: 'text' },
          { name: 'created_at', type: 'text' },
        ],
        checks: [
          new TableCheck({
            name: 'chk_order_history_decision',
            expression: `decision IN (${values([
              EngineDecision.Accepted,
              EngineDecision.PartiallyApplied,
            ])})`,
          }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'fk_order_history_order',
            columnNames: ['order_id'],
            referencedTableName: 'orders',
            referencedColumnNames: ['order_id'],
          }),
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'event_decisions',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'raw_incoming_event_id', type: 'integer' },
          { name: 'event_processing_job_id', type: 'integer' },
          { name: 'event_id', type: 'text', isNullable: true },
          { name: 'order_id', type: 'text', isNullable: true },
          { name: 'type', type: 'text', isNullable: true },
          { name: 'timestamp', type: 'integer', isNullable: true },
          { name: 'decision', type: 'text' },
          { name: 'reason_code', type: 'text' },
          { name: 'reason_message', type: 'text' },
          { name: 'details_json', type: 'text', default: "'{}'" },
          { name: 'processing_time_ms', type: 'integer', default: 0 },
          { name: 'created_at', type: 'text' },
        ],
        checks: [
          new TableCheck({
            name: 'chk_event_decisions_decision',
            expression: `decision IN (${values(Object.values(EngineDecision))})`,
          }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'fk_event_decisions_raw_event',
            columnNames: ['raw_incoming_event_id'],
            referencedTableName: 'raw_incoming_events',
            referencedColumnNames: ['id'],
          }),
          new TableForeignKey({
            name: 'fk_event_decisions_job',
            columnNames: ['event_processing_job_id'],
            referencedTableName: 'event_processing_jobs',
            referencedColumnNames: ['id'],
          }),
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'stats',
        columns: [
          { name: 'id', type: 'integer', isPrimary: true },
          { name: 'valid_events_count', type: 'integer', default: 0 },
          { name: 'accepted_events_count', type: 'integer', default: 0 },
          {
            name: 'partially_applied_events_count',
            type: 'integer',
            default: 0,
          },
          { name: 'rejected_events_count', type: 'integer', default: 0 },
          { name: 'duplicate_events_count', type: 'integer', default: 0 },
          { name: 'processed_events_count', type: 'integer', default: 0 },
          { name: 'total_processing_time_ms', type: 'integer', default: 0 },
          { name: 'updated_at', type: 'text' },
        ],
        checks: [
          new TableCheck({
            name: 'chk_stats_singleton',
            expression: 'id = 1',
          }),
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'dead_letter_events',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'event_processing_job_id', type: 'integer' },
          { name: 'raw_incoming_event_id', type: 'integer' },
          { name: 'event_id', type: 'text', isNullable: true },
          { name: 'order_id', type: 'text', isNullable: true },
          { name: 'type', type: 'text', isNullable: true },
          { name: 'timestamp', type: 'integer', isNullable: true },
          { name: 'raw_event_json', type: 'text' },
          { name: 'reason_code', type: 'text' },
          { name: 'error_message', type: 'text' },
          { name: 'attempts', type: 'integer' },
          { name: 'created_at', type: 'text' },
        ],
        checks: [
          new TableCheck({
            name: 'chk_dead_letter_events_reason',
            expression: `reason_code = '${ReasonCode.ProcessingError}'`,
          }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'fk_dead_letter_events_job',
            columnNames: ['event_processing_job_id'],
            referencedTableName: 'event_processing_jobs',
            referencedColumnNames: ['id'],
          }),
          new TableForeignKey({
            name: 'fk_dead_letter_events_raw_event',
            columnNames: ['raw_incoming_event_id'],
            referencedTableName: 'raw_incoming_events',
            referencedColumnNames: ['id'],
          }),
        ],
      }),
    );

    await this.createIndexes(queryRunner);
    await queryRunner.manager.getRepository(EngineStatsEntity).insert({
      id: 1,
      updatedAt: new Date().toISOString(),
    });
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropApplicationTables(queryRunner);
  }

  private async dropApplicationTables(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'dead_letter_events',
      'stats',
      'event_decisions',
      'order_history',
      'order_field_versions',
      'orders',
      'processed_event_keys',
      'event_processing_jobs',
      'raw_incoming_events',
    ]) {
      await queryRunner.dropTable(table, true);
    }
  }

  private async createIndexes(queryRunner: QueryRunner): Promise<void> {
    const indexes: Array<[string, TableIndex]> = [
      [
        'raw_incoming_events',
        new TableIndex({
          name: 'idx_raw_incoming_events_order_id',
          columnNames: ['order_id'],
        }),
      ],
      [
        'raw_incoming_events',
        new TableIndex({
          name: 'idx_raw_incoming_events_event_id',
          columnNames: ['event_id'],
        }),
      ],
      [
        'event_processing_jobs',
        new TableIndex({
          name: 'idx_event_processing_jobs_status_available_id',
          columnNames: ['status', 'available_at', 'id'],
        }),
      ],
      [
        'event_processing_jobs',
        new TableIndex({
          name: 'idx_event_processing_jobs_raw_incoming_event_id',
          columnNames: ['raw_incoming_event_id'],
        }),
      ],
      [
        'event_processing_jobs',
        new TableIndex({
          name: 'idx_event_processing_jobs_lock',
          columnNames: ['locked_by', 'locked_at'],
        }),
      ],
      [
        'processed_event_keys',
        new TableIndex({
          name: 'idx_processed_event_keys_order_id',
          columnNames: ['order_id'],
        }),
      ],
      [
        'order_history',
        new TableIndex({
          name: 'idx_order_history_order_id',
          columnNames: ['order_id', 'id'],
        }),
      ],
      [
        'event_decisions',
        new TableIndex({
          name: 'idx_event_decisions_order_id',
          columnNames: ['order_id', 'id'],
        }),
      ],
      [
        'event_decisions',
        new TableIndex({
          name: 'idx_event_decisions_raw_incoming_event_id',
          columnNames: ['raw_incoming_event_id'],
        }),
      ],
      [
        'event_decisions',
        new TableIndex({
          name: 'idx_event_decisions_job_id',
          columnNames: ['event_processing_job_id'],
        }),
      ],
      [
        'dead_letter_events',
        new TableIndex({
          name: 'idx_dead_letter_events_raw_incoming_event_id',
          columnNames: ['raw_incoming_event_id'],
        }),
      ],
      [
        'dead_letter_events',
        new TableIndex({
          name: 'idx_dead_letter_events_job_id',
          columnNames: ['event_processing_job_id'],
        }),
      ],
    ];

    for (const [table, index] of indexes) {
      await queryRunner.createIndex(table, index);
    }
  }
}
