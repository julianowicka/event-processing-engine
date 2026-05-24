import { Injectable, NotFoundException } from '@nestjs/common';
import type { DatabaseSync as DatabaseSyncInstance } from 'node:sqlite';
import { parseJsonObject } from '../common/json.util';
import { asSqliteRow, asSqliteRows } from '../database/sqlite-row.util';
import { SqliteService } from '../database/sqlite.service';
import { EngineDecision, JobStatus } from '../events/event.types';
import type {
  OrderHistoryDecision,
  OrderRow,
  OrderStatus,
} from '../events/event.types';
import type {
  OrderCurrentState,
  OrderDecisionEntry,
  OrderDetailsResponse,
  OrderHistoryEntry,
  OrderPendingJob,
} from './orders.types';

interface OrderHistoryRow {
  id: number;
  event_id: string;
  event_type: string;
  event_timestamp: number;
  processed_at: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  changed_fields_json: string;
  skipped_fields_json: string;
  decision: OrderHistoryDecision;
  reason_code: string;
  created_at: string;
}

interface DecisionRow {
  id: number;
  raw_incoming_event_id: number;
  event_processing_job_id: number;
  event_id: string | null;
  order_id: string | null;
  type: string | null;
  timestamp: number | null;
  decision: EngineDecision;
  reason_code: string;
  reason_message: string;
  details_json: string;
  processing_time_ms: number;
  created_at: string;
}

interface PendingJobRow {
  id: number;
  raw_incoming_event_id: number;
  status: JobStatus;
  available_at: string;
  attempts: number;
  last_reason_code: string | null;
  event_id: string | null;
  order_id: string | null;
  type: string | null;
  timestamp: number | null;
  created_at: string;
  updated_at: string;
  decision_id: number | null;
  decision_raw_incoming_event_id: number | null;
  decision_event_processing_job_id: number | null;
  decision_event_id: string | null;
  decision_order_id: string | null;
  decision_type: string | null;
  decision_timestamp: number | null;
  decision: EngineDecision | null;
  reason_code: string | null;
  reason_message: string | null;
  details_json: string | null;
  processing_time_ms: number | null;
  decision_created_at: string | null;
}

@Injectable()
export class OrdersService {
  private readonly db: DatabaseSyncInstance;

  constructor(sqliteService: SqliteService) {
    this.db = sqliteService.connection;
  }

  getOrderDetails(orderId: string): OrderDetailsResponse {
    const currentState = this.findCurrentState(orderId);
    const auditLog = this.readAuditLog(orderId);

    if (!currentState && auditLog.length === 0) {
      throw new NotFoundException(`Order ${orderId} was not found`);
    }

    return {
      orderId,
      currentState,
      history: this.readHistory(orderId),
      rejectedEvents: auditLog.filter((entry) =>
        [
          EngineDecision.Rejected,
          EngineDecision.Duplicate,
          EngineDecision.Failed,
        ].includes(entry.decision),
      ),
      pendingJobs: this.readPendingJobs(orderId),
      auditLog,
    };
  }

  private findCurrentState(orderId: string): OrderCurrentState | null {
    const row = asSqliteRow<OrderRow>(
      this.db
        .prepare(
          `
          SELECT
            order_id,
            status,
            amount_minor,
            currency,
            paid_amount_minor,
            refunded_amount_minor,
            version,
            max_accepted_event_timestamp,
            last_accepted_event_id,
            created_at,
            updated_at
          FROM orders
          WHERE order_id = ?
        `,
        )
        .get(orderId),
    );

    if (!row) {
      return null;
    }

    return {
      orderId: row.order_id,
      status: row.status,
      amountMinor: row.amount_minor,
      currency: row.currency,
      paidAmountMinor: row.paid_amount_minor,
      refundedAmountMinor: row.refunded_amount_minor,
      version: row.version,
      maxAcceptedEventTimestamp: row.max_accepted_event_timestamp,
      lastAcceptedEventId: row.last_accepted_event_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private readHistory(orderId: string): OrderHistoryEntry[] {
    return asSqliteRows<OrderHistoryRow>(
      this.db
        .prepare(
          `
            SELECT
              id,
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
            WHERE order_id = ?
            ORDER BY id ASC
          `,
        )
        .all(orderId),
    ).map((row) => ({
      id: row.id,
      eventId: row.event_id,
      type: row.event_type,
      timestamp: row.event_timestamp,
      processedAt: row.processed_at,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      changedFields: parseJsonObject(row.changed_fields_json),
      skippedFields: parseJsonObject(row.skipped_fields_json),
      decision: row.decision,
      reasonCode: row.reason_code,
      createdAt: row.created_at,
    }));
  }

  private readAuditLog(orderId: string): OrderDecisionEntry[] {
    return asSqliteRows<DecisionRow>(
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
            WHERE order_id = ?
            ORDER BY id ASC
          `,
        )
        .all(orderId),
    ).map((row) => this.mapDecision(row));
  }

  private readPendingJobs(orderId: string): OrderPendingJob[] {
    return asSqliteRows<PendingJobRow>(
      this.db
        .prepare(
          `
            SELECT
              jobs.id,
              jobs.raw_incoming_event_id,
              jobs.status,
              jobs.available_at,
              jobs.attempts,
              jobs.last_reason_code,
              raw.event_id,
              raw.order_id,
              raw.type,
              raw.event_timestamp AS timestamp,
              jobs.created_at,
              jobs.updated_at,
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
            FROM event_processing_jobs jobs
            JOIN raw_incoming_events raw ON raw.id = jobs.raw_incoming_event_id
            LEFT JOIN event_decisions decisions ON decisions.id = jobs.last_decision_id
            WHERE raw.order_id = ?
              AND jobs.status IN (?, ?)
            ORDER BY jobs.id ASC
          `,
        )
        .all(orderId, JobStatus.Pending, JobStatus.Deferred),
    ).map((row) => ({
      id: row.id,
      rawIncomingEventId: row.raw_incoming_event_id,
      status: row.status,
      availableAt: row.available_at,
      attempts: row.attempts,
      lastReasonCode: row.last_reason_code,
      eventId: row.event_id,
      orderId: row.order_id,
      type: row.type,
      timestamp: row.timestamp,
      latestDecision:
        row.decision_id === null
          ? null
          : this.mapDecision({
              id: row.decision_id,
              raw_incoming_event_id: row.decision_raw_incoming_event_id!,
              event_processing_job_id: row.decision_event_processing_job_id!,
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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private mapDecision(row: DecisionRow): OrderDecisionEntry {
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
      details: parseJsonObject(row.details_json),
      processingTimeMs: row.processing_time_ms,
      createdAt: row.created_at,
    };
  }
}
