import { Injectable } from '@nestjs/common';
import type { DatabaseSync as DatabaseSyncInstance } from 'node:sqlite';
import { SqliteService } from '../database/sqlite.service';
import { JobStatus } from './event.types';
import type { EventProjection, QueuedEventRecord } from './events.types';

@Injectable()
export class EventsRepository {
  private readonly db: DatabaseSyncInstance;

  constructor(private readonly sqliteService: SqliteService) {
    this.db = sqliteService.connection;
  }

  enqueueBatch(projections: readonly EventProjection[]): QueuedEventRecord[] {
    return this.sqliteService.transaction(() =>
      projections.map((projection) => this.enqueueSingle(projection)),
    );
  }

  private enqueueSingle(projection: EventProjection): QueuedEventRecord {
    const now = new Date().toISOString();
    const rawInsertResult = this.db
      .prepare(
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
      )
      .run(
        projection.eventId,
        projection.orderId,
        projection.type,
        projection.timestamp,
        projection.rawEventJson,
        projection.payloadJson,
        now,
      );

    const incomingEventId = Number(rawInsertResult.lastInsertRowid);
    const jobInsertResult = this.db
      .prepare(
        `
          INSERT INTO event_processing_jobs (
            raw_incoming_event_id,
            status,
            available_at,
            attempts,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, 0, ?, ?)
        `,
      )
      .run(incomingEventId, JobStatus.Pending, now, now, now);

    return {
      incomingEventId,
      processingJobId: Number(jobInsertResult.lastInsertRowid),
      projection,
    };
  }
}
