import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { DatabaseSync as DatabaseSyncInstance } from 'node:sqlite';
import { SqliteService } from '../database/sqlite.service';
import type {
  EventProjection,
  QueuedEventResult,
  QueueEventsResponse,
} from './event.types';
import { EventWorkerService } from './event-worker.service';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly db: DatabaseSyncInstance;
  private readonly verboseLogs =
    process.env.EVENT_WORKER_VERBOSE_LOGS === 'true' ||
    process.env.EVENT_WORKER_VERBOSE_LOGS === '1';

  constructor(
    private readonly sqliteService: SqliteService,
    private readonly eventWorkerService: EventWorkerService,
  ) {
    this.db = sqliteService.connection;
  }

  enqueueBatch(body: unknown): QueueEventsResponse {
    if (!Array.isArray(body)) {
      throw new BadRequestException('Request body must be a JSON array');
    }

    const results = this.sqliteService.transaction(() =>
      body.map((eventItem) => this.enqueueSingle(eventItem)),
    );

    this.verboseLog('batch queued', {
      queued: results.length,
      incomingEventIds: results.map((result) => result.incomingEventId),
      processingJobIds: results.map((result) => result.processingJobId),
    });

    this.eventWorkerService.nudge();

    return {
      mode: 'ASYNC_WORKER',
      results,
      summary: {
        queued: results.length,
      },
    };
  }

  private enqueueSingle(eventItem: unknown): QueuedEventResult {
    const now = new Date().toISOString();
    const projection = this.projectEvent(eventItem);
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
          VALUES (?, 'PENDING', ?, 0, ?, ?)
        `,
      )
      .run(incomingEventId, now, now, now);

    return {
      incomingEventId,
      processingJobId: Number(jobInsertResult.lastInsertRowid),
      eventId: projection.eventId,
      orderId: projection.orderId,
      type: projection.type,
      status: 'QUEUED',
      reasonCode: null,
      reasonMessage: 'Event queued for background processing',
      processingTimeMs: 0,
    };
  }

  private projectEvent(eventItem: unknown): EventProjection {
    const record = this.asRecord(eventItem);
    const payload = record ? this.asRecord(record.payload) : null;

    return {
      eventId: record ? this.readNonEmptyString(record.eventId) : null,
      orderId: record ? this.readNonEmptyString(record.orderId) : null,
      type: record ? this.readNonEmptyString(record.type) : null,
      timestamp: record ? this.readFiniteNumber(record.timestamp) : null,
      payloadJson: payload ? this.stringifyJson(payload) : null,
      rawEventJson: this.stringifyJson(eventItem),
    };
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private readNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private readFiniteNumber(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    return value;
  }

  private stringifyJson(value: unknown): string {
    return JSON.stringify(value) ?? 'null';
  }

  private verboseLog(message: string, details: Record<string, unknown>): void {
    if (!this.verboseLogs) {
      return;
    }

    this.logger.log(`${message} ${JSON.stringify(details)}`);
  }
}
