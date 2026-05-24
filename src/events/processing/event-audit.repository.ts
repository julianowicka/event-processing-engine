import { Injectable, Logger } from '@nestjs/common';
import type { DatabaseSync as DatabaseSyncInstance } from 'node:sqlite';
import type { JsonObject } from '../../common/json.types';
import { SqliteService } from '../../database/sqlite.service';
import { verboseLog } from '../event-verbose-logger';
import { EngineDecision, ReasonCode } from '../event.types';
import type {
  OrderHistoryDecision,
  OrderStatus,
  ProcessingJobRow,
  ValidOrderEvent,
} from '../event.types';
import type { DecisionInput, DecisionResult } from './event-processing.types';

@Injectable()
export class EventAuditRepository {
  private readonly logger = new Logger(EventAuditRepository.name);
  private readonly db: DatabaseSyncInstance;

  constructor(sqliteService: SqliteService) {
    this.db = sqliteService.connection;
  }

  writeDecision(input: DecisionInput): DecisionResult {
    const result = this.db
      .prepare(
        `
          INSERT INTO event_decisions (
            raw_incoming_event_id,
            event_processing_job_id,
            event_id,
            order_id,
            type,
            timestamp,
            decision,
            reason_code,
            reason_message,
            details_json,
            processing_time_ms,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.job.raw_incoming_event_id,
        input.job.job_id,
        input.event.eventId ?? input.job.event_id,
        input.event.orderId ?? input.job.order_id,
        input.event.type ?? input.job.type,
        input.event.timestamp ?? input.job.event_timestamp,
        input.decision,
        input.reasonCode,
        input.reasonMessage,
        JSON.stringify(input.details ?? {}),
        input.processingTimeMs,
        new Date().toISOString(),
      );

    verboseLog(this.logger, 'decision written', {
      decisionId: Number(result.lastInsertRowid),
      jobId: input.job.job_id,
      rawIncomingEventId: input.job.raw_incoming_event_id,
      eventId: input.event.eventId ?? input.job.event_id,
      orderId: input.event.orderId ?? input.job.order_id,
      type: input.event.type ?? input.job.type,
      decision: input.decision,
      reasonCode: input.reasonCode,
      reasonMessage: input.reasonMessage,
      processingTimeMs: input.processingTimeMs,
      details: input.details ?? {},
    });

    return { decisionId: Number(result.lastInsertRowid) };
  }

  updateFinalStats(decision: EngineDecision, processingTimeMs: number): void {
    const acceptedIncrement = decision === EngineDecision.Accepted ? 1 : 0;
    const partialIncrement =
      decision === EngineDecision.PartiallyApplied ? 1 : 0;
    const rejectedIncrement =
      decision === EngineDecision.Rejected || decision === EngineDecision.Failed
        ? 1
        : 0;
    const duplicateIncrement = decision === EngineDecision.Duplicate ? 1 : 0;
    const validIncrement = acceptedIncrement + partialIncrement;

    this.db
      .prepare(
        `
          UPDATE stats
          SET
            valid_events_count = valid_events_count + ?,
            accepted_events_count = accepted_events_count + ?,
            partially_applied_events_count = partially_applied_events_count + ?,
            rejected_events_count = rejected_events_count + ?,
            duplicate_events_count = duplicate_events_count + ?,
            processed_events_count = processed_events_count + 1,
            total_processing_time_ms = total_processing_time_ms + ?,
            updated_at = ?
          WHERE id = 1
        `,
      )
      .run(
        validIncrement,
        acceptedIncrement,
        partialIncrement,
        rejectedIncrement,
        duplicateIncrement,
        processingTimeMs,
        new Date().toISOString(),
      );
  }

  writeHistory(
    event: ValidOrderEvent,
    fromStatus: OrderStatus | null,
    toStatus: OrderStatus,
    changedFields: JsonObject,
    skippedFields: JsonObject,
    decision: OrderHistoryDecision,
    reasonCode: ReasonCode,
  ): void {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
          INSERT INTO order_history (
            order_id,
            event_id,
            event_type,
            event_timestamp,
            processed_at,
            from_status,
            to_status,
            changed_fields_json,
            skipped_fields_json,
            decision,
            reason_code,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        event.orderId,
        event.eventId,
        event.type,
        event.timestamp,
        now,
        fromStatus,
        toStatus,
        JSON.stringify(changedFields),
        JSON.stringify(skippedFields),
        decision,
        reasonCode,
        now,
      );
  }

  insertDeadLetterEvent(
    job: ProcessingJobRow,
    errorMessage: string,
    attempts: number,
  ): void {
    this.db
      .prepare(
        `
          INSERT INTO dead_letter_events (
            event_processing_job_id,
            raw_incoming_event_id,
            event_id,
            order_id,
            type,
            timestamp,
            raw_event_json,
            reason_code,
            error_message,
            attempts,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        job.job_id,
        job.raw_incoming_event_id,
        job.event_id,
        job.order_id,
        job.type,
        job.event_timestamp,
        job.raw_event_json,
        ReasonCode.ProcessingError,
        errorMessage,
        attempts,
        new Date().toISOString(),
      );
  }
}
