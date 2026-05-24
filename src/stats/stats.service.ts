import { Injectable } from '@nestjs/common';
import type { DatabaseSync as DatabaseSyncInstance } from 'node:sqlite';
import { asSqliteRow } from '../database/sqlite-row.util';
import { SqliteService } from '../database/sqlite.service';
import type { EngineStats, StatsRow } from './stats.types';

@Injectable()
export class StatsService {
  private readonly db: DatabaseSyncInstance;

  constructor(sqliteService: SqliteService) {
    this.db = sqliteService.connection;
  }

  getStats(): EngineStats {
    const row = asSqliteRow<StatsRow>(
      this.db
        .prepare(
          `
          SELECT
            valid_events_count,
            accepted_events_count,
            partially_applied_events_count,
            rejected_events_count,
            duplicate_events_count,
            processed_events_count,
            total_processing_time_ms,
            updated_at
          FROM stats
          WHERE id = 1
        `,
        )
        .get(),
    );

    if (!row) {
      throw new Error('Stats row was not initialized');
    }

    const rawDeliveriesCount = this.readCount('raw_incoming_events');
    const queuedJobsCount = this.readCount('event_processing_jobs');
    const pendingEventsCount = this.readJobCount(['PENDING', 'DEFERRED']);
    const deadLetterEventsCount = this.readCount('dead_letter_events');

    return {
      validEventsCount: row.valid_events_count,
      acceptedEventsCount: row.accepted_events_count,
      partiallyAppliedEventsCount: row.partially_applied_events_count,
      rejectedEventsCount: row.rejected_events_count,
      duplicateEventsCount: row.duplicate_events_count,
      processedEventsCount: row.processed_events_count,
      averageProcessingTimeMs:
        row.processed_events_count === 0
          ? 0
          : row.total_processing_time_ms / row.processed_events_count,
      pendingEventsCount,
      queuedJobsCount,
      rawDeliveriesCount,
      deadLetterEventsCount,
      updatedAt: row.updated_at,
    };
  }

  private readCount(tableName: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM ${tableName}`)
      .get() as { count: number };

    return row.count;
  }

  private readJobCount(statuses: string[]): number {
    const placeholders = statuses.map(() => '?').join(', ');
    const row = this.db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM event_processing_jobs
          WHERE status IN (${placeholders})
        `,
      )
      .get(...statuses) as { count: number };

    return row.count;
  }
}
