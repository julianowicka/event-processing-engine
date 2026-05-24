import { Injectable, NotFoundException } from '@nestjs/common';
import type { DatabaseSync as DatabaseSyncInstance } from 'node:sqlite';
import { SqliteService } from '../database/sqlite.service';
import type {
  EngineDecision,
  EventDecisionDetails,
  EventDeliveryDetails,
  EventDetailsResponse,
  EventHistoryDetails,
  JobStatus,
  OrderStatus,
  ReasonCode,
} from './event.types';

interface EventDecisionRow {
  id: number;
  raw_incoming_event_id: number;
  event_processing_job_id: number;
  event_id: string | null;
  order_id: string | null;
  type: string | null;
  timestamp: number | null;
  decision: EngineDecision;
  reason_code: ReasonCode;
  reason_message: string;
  details_json: string;
  processing_time_ms: number;
  created_at: string;
}

interface EventDeliveryRow {
  raw_incoming_event_id: number;
  event_id: string | null;
  order_id: string | null;
  type: string | null;
  event_timestamp: number | null;
  raw_event_json: string;
  payload_json: string | null;
  received_at: string;
  job_id: number | null;
  job_status: JobStatus | null;
  available_at: string | null;
  attempts: number | null;
  last_reason_code: string | null;
  job_created_at: string | null;
  job_updated_at: string | null;
  decision_id: number | null;
  decision_raw_incoming_event_id: number | null;
  decision_event_processing_job_id: number | null;
  decision_event_id: string | null;
  decision_order_id: string | null;
  decision_type: string | null;
  decision_timestamp: number | null;
  decision: EngineDecision | null;
  reason_code: ReasonCode | null;
  reason_message: string | null;
  details_json: string | null;
  processing_time_ms: number | null;
  decision_created_at: string | null;
}

interface EventHistoryRow {
  id: number;
  order_id: string;
  event_id: string;
  event_type: string;
  event_timestamp: number;
  processed_at: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  changed_fields_json: string;
  skipped_fields_json: string;
  decision: 'ACCEPTED' | 'PARTIALLY_APPLIED';
  reason_code: string;
  created_at: string;
}

@Injectable()
export class EventReadService {
  private readonly db: DatabaseSyncInstance;

  constructor(sqliteService: SqliteService) {
    this.db = sqliteService.connection;
  }

  getEventDetails(eventId: string): EventDetailsResponse {
    const deliveries = this.readDeliveries(eventId);
    const decisions = this.readDecisions(eventId);
    const history = this.readHistory(eventId);

    if (
      deliveries.length === 0 &&
      decisions.length === 0 &&
      history.length === 0
    ) {
      throw new NotFoundException(`Event ${eventId} was not found`);
    }

    return {
      eventId,
      orderIds: this.collectOrderIds(deliveries, decisions, history),
      deliveries,
      decisions,
      history,
    };
  }

  private readDeliveries(eventId: string): EventDeliveryDetails[] {
    return (
      this.db
        .prepare(
          `
            SELECT
              raw.id AS raw_incoming_event_id,
              raw.event_id,
              raw.order_id,
              raw.type,
              raw.event_timestamp,
              raw.raw_event_json,
              raw.payload_json,
              raw.received_at,
              jobs.id AS job_id,
              jobs.status AS job_status,
              jobs.available_at,
              jobs.attempts,
              jobs.last_reason_code,
              jobs.created_at AS job_created_at,
              jobs.updated_at AS job_updated_at,
              decisions.id AS decision_id,
              decisions.raw_incoming_event_id AS decision_raw_incoming_event_id,
              decisions.event_processing_job_id AS decision_event_processing_job_id,
              decisions.event_id AS decision_event_id,
              decisions.order_id AS decision_order_id,
              decisions.type AS decision_type,
              decisions.timestamp AS decision_timestamp,
              decisions.decision,
              decisions.reason_code,
              decisions.reason_message,
              decisions.details_json,
              decisions.processing_time_ms,
              decisions.created_at AS decision_created_at
            FROM raw_incoming_events raw
            LEFT JOIN event_processing_jobs jobs
              ON jobs.raw_incoming_event_id = raw.id
            LEFT JOIN event_decisions decisions
              ON decisions.id = jobs.last_decision_id
            WHERE raw.event_id = ?
            ORDER BY raw.id ASC
          `,
        )
        .all(eventId) as unknown as EventDeliveryRow[]
    ).map((row) => ({
      rawIncomingEventId: row.raw_incoming_event_id,
      eventId: row.event_id,
      orderId: row.order_id,
      type: row.type,
      timestamp: row.event_timestamp,
      receivedAt: row.received_at,
      payload:
        row.payload_json === null ? null : this.parseObject(row.payload_json),
      rawEvent: JSON.parse(row.raw_event_json) as unknown,
      processingJob:
        row.job_id === null
          ? null
          : {
              id: row.job_id,
              status: row.job_status!,
              availableAt: row.available_at!,
              attempts: row.attempts!,
              lastReasonCode: row.last_reason_code,
              createdAt: row.job_created_at!,
              updatedAt: row.job_updated_at!,
              latestDecision:
                row.decision_id === null
                  ? null
                  : this.mapDecision({
                      id: row.decision_id,
                      raw_incoming_event_id:
                        row.decision_raw_incoming_event_id!,
                      event_processing_job_id:
                        row.decision_event_processing_job_id!,
                      event_id: row.decision_event_id,
                      order_id: row.decision_order_id,
                      type: row.decision_type,
                      timestamp: row.decision_timestamp,
                      decision: row.decision!,
                      reason_code: row.reason_code!,
                      reason_message: row.reason_message!,
                      details_json: row.details_json!,
                      processing_time_ms: row.processing_time_ms!,
                      created_at: row.decision_created_at!,
                    }),
            },
    }));
  }

  private readDecisions(eventId: string): EventDecisionDetails[] {
    return (
      this.db
        .prepare(
          `
            SELECT
              id,
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
            FROM event_decisions
            WHERE event_id = ?
            ORDER BY id ASC
          `,
        )
        .all(eventId) as unknown as EventDecisionRow[]
    ).map((row) => this.mapDecision(row));
  }

  private readHistory(eventId: string): EventHistoryDetails[] {
    return (
      this.db
        .prepare(
          `
            SELECT
              id,
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
            FROM order_history
            WHERE event_id = ?
            ORDER BY id ASC
          `,
        )
        .all(eventId) as unknown as EventHistoryRow[]
    ).map((row) => ({
      id: row.id,
      orderId: row.order_id,
      eventId: row.event_id,
      type: row.event_type,
      timestamp: row.event_timestamp,
      processedAt: row.processed_at,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      changedFields: this.parseObject(row.changed_fields_json),
      skippedFields: this.parseObject(row.skipped_fields_json),
      decision: row.decision,
      reasonCode: row.reason_code,
      createdAt: row.created_at,
    }));
  }

  private mapDecision(row: EventDecisionRow): EventDecisionDetails {
    return {
      id: row.id,
      rawIncomingEventId: row.raw_incoming_event_id,
      processingJobId: row.event_processing_job_id,
      eventId: row.event_id,
      orderId: row.order_id,
      type: row.type,
      timestamp: row.timestamp,
      decision: row.decision,
      reasonCode: row.reason_code,
      reasonMessage: row.reason_message,
      details: this.parseObject(row.details_json),
      processingTimeMs: row.processing_time_ms,
      createdAt: row.created_at,
    };
  }

  private collectOrderIds(
    deliveries: EventDeliveryDetails[],
    decisions: EventDecisionDetails[],
    history: EventHistoryDetails[],
  ): string[] {
    return [
      ...new Set(
        [
          ...deliveries.map((delivery) => delivery.orderId),
          ...decisions.map((decision) => decision.orderId),
          ...history.map((entry) => entry.orderId),
        ].filter((orderId): orderId is string => Boolean(orderId)),
      ),
    ];
  }

  private parseObject(json: string): Record<string, unknown> {
    const value = JSON.parse(json) as unknown;

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return {};
  }
}
