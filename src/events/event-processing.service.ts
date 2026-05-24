



























































import { Injectable, Logger } from '@nestjs/common';
import type { DatabaseSync as DatabaseSyncInstance } from 'node:sqlite';
import { SqliteService } from '../database/sqlite.service';
import {
  EngineDecision,
  OrderRow,
  OrderStatus,
  orderStatuses,
  ProcessJobOutcome,
  ProcessingJobRow,
  ReasonCode,
  supportedEventTypes,
  SupportedEventType,
  ValidOrderEvent,
} from './event.types';

interface DecisionInput {
  job: ProcessingJobRow;
  event: Partial<ValidOrderEvent>;
  decision: EngineDecision;
  reasonCode: ReasonCode;
  reasonMessage: string;
  details?: Record<string, unknown>;
  processingTimeMs: number;
}

interface DecisionResult {
  decisionId: number;
}

interface FieldChangeSet {
  changed: Record<string, unknown>;
  skipped: Record<string, unknown>;
}

@Injectable()
export class EventProcessingService {
  private readonly logger = new Logger(EventProcessingService.name);
  private readonly db: DatabaseSyncInstance;
  private readonly verboseLogs =
    process.env.EVENT_WORKER_VERBOSE_LOGS === 'true' ||
    process.env.EVENT_WORKER_VERBOSE_LOGS === '1';
  private readonly maxAttempts = 3;
  private readonly retryDelayMs = 3_000;
  private readonly deferredRetryMs = 60_000;
  private readonly lockTimeoutMs = Number(
    process.env.EVENT_WORKER_LOCK_TIMEOUT_MS ?? 30_000,
  );
  private readonly workerId = [
    'worker',
    process.pid,
    Date.now(),
    Math.random().toString(36).slice(2),
  ].join('-');

  constructor(private readonly sqliteService: SqliteService) {
    this.db = sqliteService.connection;
  }

  processNextAvailableJob(): ProcessJobOutcome | null {
    const job = this.claimNextAvailableJob();

    if (!job) {
      return null;
    }

    try {
      return this.sqliteService.transaction(() => this.processBusinessJob(job));
    } catch (error) {
      this.recordTechnicalFailure(job, error);
      return { orderChanged: false };
    }
  }

  private claimNextAvailableJob(): ProcessingJobRow | null {
    return this.sqliteService.transaction(() => {
      const now = new Date();
      const nowIso = now.toISOString();
      const staleBeforeIso = new Date(
        now.getTime() - this.lockTimeoutMs,
      ).toISOString();
      const claimed = this.db
        .prepare(
          `
            UPDATE event_processing_jobs
            SET
              locked_by = ?,
              locked_at = ?,
              updated_at = ?
            WHERE id = (
              SELECT jobs.id
              FROM event_processing_jobs jobs
              JOIN raw_incoming_events raw ON raw.id = jobs.raw_incoming_event_id
              WHERE jobs.status IN ('PENDING', 'DEFERRED')
                AND jobs.available_at <= ?
                AND (
                  jobs.locked_by IS NULL
                  OR jobs.locked_at IS NULL
                  OR jobs.locked_at <= ?
                )
              ORDER BY raw.id ASC
              LIMIT 1
            )
            RETURNING id
          `,
        )
        .get(this.workerId, nowIso, nowIso, nowIso, staleBeforeIso) as
        | { id: number }
        | undefined;

      if (!claimed) {
        return null;
      }

      const job = this.db
        .prepare(
          `
            SELECT
              jobs.id AS job_id,
              jobs.raw_incoming_event_id,
              jobs.status,
              jobs.attempts,
              jobs.locked_by,
              jobs.locked_at,
              raw.raw_event_json,
              raw.event_id,
              raw.order_id,
              raw.type,
              raw.event_timestamp
            FROM event_processing_jobs jobs
            JOIN raw_incoming_events raw ON raw.id = jobs.raw_incoming_event_id
            WHERE jobs.id = ?
          `,
        )
        .get(claimed.id) as unknown as ProcessingJobRow;

      this.verboseLog('claimed job', {
        jobId: job.job_id,
        rawIncomingEventId: job.raw_incoming_event_id,
        eventId: job.event_id,
        orderId: job.order_id,
        type: job.type,
        status: job.status,
        workerId: this.workerId,
      });

      return job;
    });
  }

  private processBusinessJob(job: ProcessingJobRow): ProcessJobOutcome {
    const startedAt = Date.now();
    const validation = this.validateRawEvent(job);

    if (!validation.valid) {
      this.finishWithDecision({
        job,
        event: this.partialEventFromJob(job),
        decision: 'REJECTED',
        reasonCode: validation.reason
        Code,
        reasonMessage: validation.reasonMessage,
        details: validation.details,
        processingTimeMs: Date.now() - startedAt,
      });
      return { orderChanged: false };
    }

    const event = validation.event;

    if (!this.claimDeduplicationKey(job, event)) {
      this.finishWithDecision({
        job,
        event,
        decision: 'DUPLICATE',
        reasonCode: 'DUPLICATE_EVENT',
        reasonMessage: `Event ${event.eventId} was already processed or claimed`,
        processingTimeMs: Date.now() - startedAt,
      });
      return { orderChanged: false };
    }

    const order = this.findOrder(event.orderId);

    if (!order && event.type !== 'ORDER_CREATED') {
      this.deferJob(job, event, Date.now() - startedAt);
      return { orderChanged: false };
    }

    switch (event.type) {
      case 'ORDER_CREATED':
        return this.processOrderCreated(job, event, order, startedAt);
      case 'ORDER_UPDATED':
        return this.processOrderUpdated(job, event, order!, startedAt);
      case 'PAYMENT_CAPTURED':
        return this.processPaymentCaptured(job, event, order!, startedAt);
      case 'ORDER_CANCELLED':
        return this.processOrderCancelled(job, event, order!, startedAt);
      case 'REFUND_ISSUED':
        return this.processRefundIssued(job, event, order!, startedAt);
    }
  }

  private processOrderCreated(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
    existingOrder: OrderRow | null,
    startedAt: number,
  ): ProcessJobOutcome {
    if (existingOrder) {
      this.finishWithDecision({
        job,
        event,
        decision: 'REJECTED',
        reasonCode: 'ORDER_ALREADY_EXISTS',
        reasonMessage: `Order ${event.orderId} already exists`,
        processingTimeMs: Date.now() - startedAt,
      });
      return { orderChanged: false };
    }

    const amountMinor = this.optionalMoneyToMinor(event.payload.amount);
    const currency = this.optionalCurrency(event.payload.currency);
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
          INSERT INTO orders (
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
          )
          VALUES (?, 'CREATED', ?, ?, 0, 0, 1, ?, ?, ?, ?)
        `,
      )
      .run(
        event.orderId,
        amountMinor,
        currency,
        event.timestamp,
        event.eventId,
        now,
        now,
      );

    this.upsertFieldVersion(event.orderId, 'status', event);

    if (amountMinor !== null) {
      this.upsertFieldVersion(event.orderId, 'amountMinor', event);
    }

    if (currency !== null) {
      this.upsertFieldVersion(event.orderId, 'currency', event);
    }

    const changed = {
      status: 'CREATED',
      ...(amountMinor === null ? {} : { amountMinor }),
      ...(currency === null ? {} : { currency }),
    };

    this.writeHistory(
      event,
      null,
      'CREATED',
      changed,
      {},
      'ACCEPTED',
      'APPLIED',
    );
    this.finishWithDecision({
      job,
      event,
      decision: 'ACCEPTED',
      reasonCode: 'APPLIED',
      reasonMessage: `Order ${event.orderId} was created`,
      details: { changedFields: changed },
      processingTimeMs: Date.now() - startedAt,
    });
    this.releaseDeferredJobsForOrder(event.orderId);
    return { orderChanged: true };
  }

  private processOrderUpdated(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
    order: OrderRow,
    startedAt: number,
  ): ProcessJobOutcome {
    const fields: FieldChangeSet = { changed: {}, skipped: {} };
    let nextAmountMinor = order.amount_minor;
    let nextCurrency = order.currency;
    let nextStatus = order.status;

    if (Object.prototype.hasOwnProperty.call(event.payload, 'amount')) {
      const amountMinor = this.optionalMoneyToMinor(event.payload.amount);
      if (this.canApplyField(event.orderId, 'amountMinor', event)) {
        nextAmountMinor = amountMinor;
        fields.changed.amountMinor = amountMinor;
      } else {
        fields.skipped.amountMinor = 'OBSOLETE_FIELD';
      }
    }

    if (Object.prototype.hasOwnProperty.call(event.payload, 'currency')) {
      const currency = this.optionalCurrency(event.payload.currency);
      if (this.canApplyField(event.orderId, 'currency', event)) {
        nextCurrency = currency;
        fields.changed.currency = currency;
      } else {
        fields.skipped.currency = 'OBSOLETE_FIELD';
      }
    }

    if (Object.prototype.hasOwnProperty.call(event.payload, 'status')) {
      const requestedStatus = this.readOrderStatus(event.payload.status);
      if (!this.canApplyField(event.orderId, 'status', event)) {
        fields.skipped.status = 'OBSOLETE_FIELD';
      } else if (!this.canTransition(order.status, requestedStatus)) {
        fields.skipped.status = 'FORBIDDEN_TRANSITION';
      } else {
        nextStatus = requestedStatus;
        fields.changed.status = requestedStatus;
      }
    }

    return this.finishStateMutation(
      job,
      event,
      order,
      {
        status: nextStatus,
        amountMinor: nextAmountMinor,
        currency: nextCurrency,
        paidAmountMinor: order.paid_amount_minor,
        refundedAmountMinor: order.refunded_amount_minor,
      },
      fields,
      startedAt,
    );
  }

  private processPaymentCaptured(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
    order: OrderRow,
    startedAt: number,
  ): ProcessJobOutcome {
    const paymentAmount =
      Object.prototype.hasOwnProperty.call(event.payload, 'amount') ||
      order.amount_minor === null
        ? this.positiveMoneyToMinor(event.payload.amount)
        : order.amount_minor;

    if (paymentAmount === null || paymentAmount <= 0) {
      this.finishWithDecision({
        job,
        event,
        decision: 'REJECTED',
        reasonCode: 'PAYMENT_AMOUNT_REQUIRED',
        reasonMessage: 'A positive payment amount is required',
        processingTimeMs: Date.now() - startedAt,
      });
      return { orderChanged: false };
    }

    if (order.paid_amount_minor > 0) {
      this.finishWithDecision({
        job,
        event,
        decision: 'REJECTED',
        reasonCode: 'PAYMENT_ALREADY_CAPTURED',
        reasonMessage: `Order ${event.orderId} already has a captured payment`,
        processingTimeMs: Date.now() - startedAt,
      });
      return { orderChanged: false };
    }

    if (!this.canTransition(order.status, 'PAID')) {
      this.finishWithDecision({
        job,
        event,
        decision: 'REJECTED',
        reasonCode: 'FORBIDDEN_TRANSITION',
        reasonMessage: `Cannot move order ${event.orderId} from ${order.status} to PAID`,
        processingTimeMs: Date.now() - startedAt,
      });
      return { orderChanged: false };
    }

    return this.finishStateMutation(
      job,
      event,
      order,
      {
        status: 'PAID',
        amountMinor: order.amount_minor,
        currency: order.currency,
        paidAmountMinor: paymentAmount,
        refundedAmountMinor: order.refunded_amount_minor,
      },
      {
        changed: { status: 'PAID', paidAmountMinor: paymentAmount },
        skipped: {},
      },
      startedAt,
    );
  }

  private processOrderCancelled(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
    order: OrderRow,
    startedAt: number,
  ): ProcessJobOutcome {
    if (!this.canTransition(order.status, 'CANCELLED')) {
      this.finishWithDecision({
        job,
        event,
        decision: 'REJECTED',
        reasonCode: 'FORBIDDEN_TRANSITION',
        reasonMessage: `Cannot move order ${event.orderId} from ${order.status} to CANCELLED`,
        processingTimeMs: Date.now() - startedAt,
      });
      return { orderChanged: false };
    }

    return this.finishStateMutation(
      job,
      event,
      order,
      {
        status: 'CANCELLED',
        amountMinor: order.amount_minor,
        currency: order.currency,
        paidAmountMinor: order.paid_amount_minor,
        refundedAmountMinor: order.refunded_amount_minor,
      },
      {
        changed: { status: 'CANCELLED' },
        skipped: {},
      },
      startedAt,
    );
  }

  private processRefundIssued(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
    order: OrderRow,
    startedAt: number,
  ): ProcessJobOutcome {
    const amountValue = Object.prototype.hasOwnProperty.call(
      event.payload,
      'refundAmount',
    )
      ? event.payload.refundAmount
      : event.payload.amount;
    const refundAmount = this.positiveMoneyToMinor(amountValue);

    if (refundAmount === null || refundAmount <= 0) {
      this.finishWithDecision({
        job,
        event,
        decision: 'REJECTED',
        reasonCode: 'REFUND_AMOUNT_REQUIRED',
        reasonMessage: 'A positive refund amount is required',
        processingTimeMs: Date.now() - startedAt,
      });
      return { orderChanged: false };
    }

    if (
      order.status === 'CREATED' &&
      this.hasPendingPaymentForOrder(event.orderId, event.timestamp)
    ) {
      this.deferJob(job, event, Date.now() - startedAt);
      return { orderChanged: false };
    }

    if (order.status !== 'PAID' && order.status !== 'PARTIALLY_REFUNDED') {
      this.finishWithDecision({
        job,
        event,
        decision: 'REJECTED',
        reasonCode: 'FORBIDDEN_TRANSITION',
        reasonMessage: `Cannot refund order ${event.orderId} from ${order.status}`,
        processingTimeMs: Date.now() - startedAt,
      });
      return { orderChanged: false };
    }

    const nextRefundedAmount = order.refunded_amount_minor + refundAmount;

    if (nextRefundedAmount > order.paid_amount_minor) {
      this.finishWithDecision({
        job,
        event,
        decision: 'REJECTED',
        reasonCode: 'REFUND_EXCEEDS_CAPTURED',
        reasonMessage: `Refund would exceed captured payment for order ${event.orderId}`,
        processingTimeMs: Date.now() - startedAt,
      });
      return { orderChanged: false };
    }

    const nextStatus: OrderStatus =
      nextRefundedAmount === order.paid_amount_minor
        ? 'REFUNDED'
        : 'PARTIALLY_REFUNDED';

    return this.finishStateMutation(
      job,
      event,
      order,
      {
        status: nextStatus,
        amountMinor: order.amount_minor,
        currency: order.currency,
        paidAmountMinor: order.paid_amount_minor,
        refundedAmountMinor: nextRefundedAmount,
      },
      {
        changed: {
          status: nextStatus,
          refundedAmountMinor: nextRefundedAmount,
        },
        skipped: {},
      },
      startedAt,
    );
  }

  private finishStateMutation(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
    order: OrderRow,
    nextState: {
      status: OrderStatus;
      amountMinor: number | null;
      currency: string | null;
      paidAmountMinor: number;
      refundedAmountMinor: number;
    },
    fields: FieldChangeSet,
    startedAt: number,
  ): ProcessJobOutcome {
    const changedKeys = Object.keys(fields.changed);
    const skippedKeys = Object.keys(fields.skipped);

    if (changedKeys.length === 0) {
      const forbiddenTransition = Object.values(fields.skipped).includes(
        'FORBIDDEN_TRANSITION',
      );
      this.finishWithDecision({
        job,
        event,
        decision: 'REJECTED',
        reasonCode: forbiddenTransition
          ? 'FORBIDDEN_TRANSITION'
          : 'OBSOLETE_EVENT',
        reasonMessage: forbiddenTransition
          ? `Event ${event.eventId} requested a forbidden transition`
          : `Event ${event.eventId} had no applicable changes`,
        details: { skippedFields: fields.skipped },
        processingTimeMs: Date.now() - startedAt,
      });
      return { orderChanged: false };
    }

    const decision: EngineDecision =
      skippedKeys.length > 0 ? 'PARTIALLY_APPLIED' : 'ACCEPTED';
    const reasonCode: ReasonCode =
      decision === 'PARTIALLY_APPLIED' ? 'PARTIAL_MERGE' : 'APPLIED';
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
          UPDATE orders
          SET
            status = ?,
            amount_minor = ?,
            currency = ?,
            paid_amount_minor = ?,
            refunded_amount_minor = ?,
            version = version + 1,
            max_accepted_event_timestamp = MAX(max_accepted_event_timestamp, ?),
            last_accepted_event_id = ?,
            updated_at = ?
          WHERE order_id = ?
        `,
      )
      .run(
        nextState.status,
        nextState.amountMinor,
        nextState.currency,
        nextState.paidAmountMinor,
        nextState.refundedAmountMinor,
        event.timestamp,
        event.eventId,
        now,
        event.orderId,
      );

    for (const fieldName of changedKeys) {
      this.upsertFieldVersion(event.orderId, fieldName, event);
    }

    this.writeHistory(
      event,
      order.status,
      nextState.status,
      fields.changed,
      fields.skipped,
      decision,
      reasonCode,
    );
    this.finishWithDecision({
      job,
      event,
      decision,
      reasonCode,
      reasonMessage:
        decision === 'PARTIALLY_APPLIED'
          ? `Event ${event.eventId} was partially applied`
          : `Event ${event.eventId} was applied`,
      details: {
        changedFields: fields.changed,
        skippedFields: fields.skipped,
      },
      processingTimeMs: Date.now() - startedAt,
    });
    this.releaseDeferredJobsForOrder(event.orderId);
    return { orderChanged: true };
  }

  private finishWithDecision(input: DecisionInput): DecisionResult {
    const decision = this.writeDecision(input);
    const final = input.decision !== 'DEFERRED';

    if (final) {
      this.updateFinalStats(input.decision, input.processingTimeMs);
    }

    this.db
      .prepare(
        `
          UPDATE event_processing_jobs
          SET
            status = ?,
            last_decision_id = ?,
            last_reason_code = ?,
            locked_by = NULL,
            locked_at = NULL,
            updated_at = ?
          WHERE id = ?
            AND locked_by = ?
        `,
      )
      .run(
        final ? 'DONE' : 'DEFERRED',
        decision.decisionId,
        input.reasonCode,
        new Date().toISOString(),
        input.job.job_id,
        this.workerId,
      );

    return decision;
  }

  private deferJob(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
    processingTimeMs: number,
  ): void {
    const decision = this.writeDecision({
      job,
      event,
      decision: 'DEFERRED',
      reasonCode: 'ORDER_NOT_READY',
      reasonMessage: `Order ${event.orderId} does not exist yet`,
      processingTimeMs,
    });
    const now = new Date();
    const availableAt = new Date(
      now.getTime() + this.deferredRetryMs,
    ).toISOString();

    this.db
      .prepare(
        `
          UPDATE event_processing_jobs
          SET
            status = 'DEFERRED',
            available_at = ?,
            last_decision_id = ?,
            last_reason_code = 'ORDER_NOT_READY',
            locked_by = NULL,
            locked_at = NULL,
            updated_at = ?
          WHERE id = ?
            AND locked_by = ?
        `,
      )
      .run(
        availableAt,
        decision.decisionId,
        now.toISOString(),
        job.job_id,
        this.workerId,
      );
  }

  private hasPendingPaymentForOrder(
    orderId: string,
    refundTimestamp: number,
  ): boolean {
    const row = this.db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM event_processing_jobs jobs
          JOIN raw_incoming_events raw ON raw.id = jobs.raw_incoming_event_id
          WHERE raw.order_id = ?
            AND raw.type = 'PAYMENT_CAPTURED'
            AND raw.event_timestamp <= ?
            AND jobs.status IN ('PENDING', 'DEFERRED')
        `,
      )
      .get(orderId, refundTimestamp) as { count: number };

    return row.count > 0;
  }

  private writeDecision(input: DecisionInput): DecisionResult {
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

    this.verboseLog('decision written', {
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

  private updateFinalStats(
    decision: EngineDecision,
    processingTimeMs: number,
  ): void {
    const acceptedIncrement = decision === 'ACCEPTED' ? 1 : 0;
    const partialIncrement = decision === 'PARTIALLY_APPLIED' ? 1 : 0;
    const rejectedIncrement =
      decision === 'REJECTED' || decision === 'FAILED' ? 1 : 0;
    const duplicateIncrement = decision === 'DUPLICATE' ? 1 : 0;
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

  private writeHistory(
    event: ValidOrderEvent,
    fromStatus: OrderStatus | null,
    toStatus: OrderStatus,
    changedFields: Record<string, unknown>,
    skippedFields: Record<string, unknown>,
    decision: 'ACCEPTED' | 'PARTIALLY_APPLIED',
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

  private claimDeduplicationKey(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
  ): boolean {
    const existing = this.db
      .prepare(
        `
          SELECT first_raw_incoming_event_id
          FROM processed_event_keys
          WHERE event_id = ?
        `,
      )
      .get(event.eventId) as
      | { first_raw_incoming_event_id: number }
      | undefined;

    if (existing) {
      return existing.first_raw_incoming_event_id === job.raw_incoming_event_id;
    }

    this.db
      .prepare(
        `
          INSERT INTO processed_event_keys (
            event_id,
            first_raw_incoming_event_id,
            order_id,
            first_seen_at
          )
          VALUES (?, ?, ?, ?)
        `,
      )
      .run(
        event.eventId,
        job.raw_incoming_event_id,
        event.orderId,
        new Date().toISOString(),
      );

    return true;
  }

  private findOrder(orderId: string): OrderRow | null {
    const row = this.db
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
      .get(orderId) as unknown as OrderRow | undefined;

    return row ?? null;
  }

  private canApplyField(
    orderId: string,
    fieldName: string,
    event: ValidOrderEvent,
  ): boolean {
    const row = this.db
      .prepare(
        `
          SELECT last_event_timestamp
          FROM order_field_versions
          WHERE order_id = ? AND field_name = ?
        `,
      )
      .get(orderId, fieldName) as { last_event_timestamp: number } | undefined;

    return !row || event.timestamp > row.last_event_timestamp;
  }

  private upsertFieldVersion(
    orderId: string,
    fieldName: string,
    event: ValidOrderEvent,
  ): void {
    this.db
      .prepare(
        `
          INSERT INTO order_field_versions (
            order_id,
            field_name,
            last_event_timestamp,
            last_event_id,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(order_id, field_name) DO UPDATE SET
            last_event_timestamp = excluded.last_event_timestamp,
            last_event_id = excluded.last_event_id,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        orderId,
        fieldName,
        event.timestamp,
        event.eventId,
        new Date().toISOString(),
      );
  }

  private releaseDeferredJobsForOrder(orderId: string): void {
    this.db
      .prepare(
        `
          UPDATE event_processing_jobs
          SET available_at = ?, updated_at = ?
          WHERE status = 'DEFERRED'
            AND locked_by IS NULL
            AND raw_incoming_event_id IN (
              SELECT id
              FROM raw_incoming_events
              WHERE order_id = ?
            )
        `,
      )
      .run(new Date().toISOString(), new Date().toISOString(), orderId);
  }

  private canTransition(from: OrderStatus, to: OrderStatus): boolean {
    if (from === to) {
      return true;
    }

    const allowed: Record<OrderStatus, OrderStatus[]> = {
      CREATED: ['PAID', 'CANCELLED'],
      PAID: ['PARTIALLY_REFUNDED', 'REFUNDED'],
      CANCELLED: [],
      PARTIALLY_REFUNDED: ['REFUNDED'],
      REFUNDED: [],
    };

    return allowed[from].includes(to);
  }

  private validateRawEvent(job: ProcessingJobRow):
    | { valid: true; event: ValidOrderEvent }
    | {
        valid: false;
        reasonCode: ReasonCode;
        reasonMessage: string;
        details?: Record<string, unknown>;
      } {
    const raw = JSON.parse(job.raw_event_json) as unknown;

    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return {
        valid: false,
        reasonCode: 'INVALID_SCHEMA',
        reasonMessage: 'Event item must be a JSON object',
      };
    }

    const record = raw as Record<string, unknown>;
    const eventId = this.readRequiredString(record.eventId);
    const orderId = this.readRequiredString(record.orderId);
    const timestamp = this.readRequiredTimestamp(record.timestamp);
    const payload = this.readPayload(record.payload);

    if (!eventId || !orderId || timestamp === null || !payload.valid) {
      return {
        valid: false,
        reasonCode: 'INVALID_SCHEMA',
        reasonMessage:
          'Event is missing required fields or has invalid payload',
        details: {
          eventId: Boolean(eventId),
          orderId: Boolean(orderId),
          timestamp: timestamp !== null,
          payload: payload.valid,
        },
      };
    }

    if (typeof record.type !== 'string') {
      return {
        valid: false,
        reasonCode: 'INVALID_SCHEMA',
        reasonMessage: 'Event type must be a string',
      };
    }

    if (!supportedEventTypes.includes(record.type as SupportedEventType)) {
      return {
        valid: false,
        reasonCode: 'UNKNOWN_EVENT_TYPE',
        reasonMessage: `Unsupported event type: ${record.type}`,
      };
    }

    const event = {
      eventId,
      orderId,
      type: record.type as SupportedEventType,
      timestamp,
      payload: payload.value,
    };
    const payloadError = this.validatePayloadValues(event);

    if (payloadError) {
      return payloadError;
    }

    return { valid: true, event };
  }

  private validatePayloadValues(event: ValidOrderEvent): {
    valid: false;
    reasonCode: ReasonCode;
    reasonMessage: string;
    details?: Record<string, unknown>;
  } | null {
    try {
      if (Object.prototype.hasOwnProperty.call(event.payload, 'amount')) {
        this.optionalMoneyToMinor(event.payload.amount);
      }

      if (Object.prototype.hasOwnProperty.call(event.payload, 'refundAmount')) {
        this.optionalMoneyToMinor(event.payload.refundAmount);
      }

      if (Object.prototype.hasOwnProperty.call(event.payload, 'currency')) {
        this.optionalCurrency(event.payload.currency);
      }

      if (Object.prototype.hasOwnProperty.call(event.payload, 'status')) {
        this.readOrderStatus(event.payload.status);
      }
    } catch (error) {
      return {
        valid: false,
        reasonCode: 'INVALID_SCHEMA',
        reasonMessage:
          error instanceof Error ? error.message : 'Invalid payload values',
      };
    }

    return null;
  }

  private partialEventFromJob(job: ProcessingJobRow): Partial<ValidOrderEvent> {
    return {
      eventId: job.event_id ?? undefined,
      orderId: job.order_id ?? undefined,
      type: supportedEventTypes.includes(job.type as SupportedEventType)
        ? (job.type as SupportedEventType)
        : undefined,
      timestamp: job.event_timestamp ?? undefined,
    };
  }

  private readPayload(
    value: unknown,
  ): { valid: true; value: Record<string, unknown> } | { valid: false } {
    if (value === undefined) {
      return { valid: true, value: {} };
    }

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { valid: false };
    }

    return { valid: true, value: value as Record<string, unknown> };
  }

  private readRequiredString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private readRequiredTimestamp(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private readOrderStatus(value: unknown): OrderStatus {
    if (
      typeof value !== 'string' ||
      !orderStatuses.includes(value as OrderStatus)
    ) {
      throw new Error('Invalid order status');
    }

    return value as OrderStatus;
  }

  private optionalCurrency(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
      throw new Error('Invalid currency field');
    }

    return value;
  }

  private optionalMoneyToMinor(value: unknown): number | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error('Invalid money field');
    }

    const minor = Math.round(value * 100);

    if (Math.abs(value * 100 - minor) > 1e-6) {
      throw new Error('Money field supports at most two decimal places');
    }

    return minor;
  }

  private positiveMoneyToMinor(value: unknown): number | null {
    try {
      const minor = this.optionalMoneyToMinor(value);
      return minor !== null && minor > 0 ? minor : null;
    } catch {
      return null;
    }
  }

  private recordTechnicalFailure(job: ProcessingJobRow, error: unknown): void {
    this.sqliteService.transaction(() => {
      const attempts = job.attempts + 1;
      const now = new Date();
      const message = error instanceof Error ? error.message : String(error);

      if (attempts >= this.maxAttempts) {
        const decision = this.writeDecision({
          job,
          event: this.partialEventFromJob(job),
          decision: 'FAILED',
          reasonCode: 'PROCESSING_ERROR',
          reasonMessage: message,
          processingTimeMs: 0,
        });
        this.updateFinalStats('FAILED', 0);
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
              VALUES (?, ?, ?, ?, ?, ?, ?, 'PROCESSING_ERROR', ?, ?, ?)
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
            message,
            attempts,
            now.toISOString(),
          );
        this.db
          .prepare(
            `
              UPDATE event_processing_jobs
              SET
                status = 'DEAD_LETTERED',
                attempts = ?,
                last_error_message = ?,
                last_decision_id = ?,
                last_reason_code = 'PROCESSING_ERROR',
                locked_by = NULL,
                locked_at = NULL,
                updated_at = ?
              WHERE id = ?
                AND locked_by = ?
            `,
          )
          .run(
            attempts,
            message,
            decision.decisionId,
            now.toISOString(),
            job.job_id,
            this.workerId,
          );
        return;
      }

      this.db
        .prepare(
          `
            UPDATE event_processing_jobs
            SET
              status = 'PENDING',
              attempts = ?,
              available_at = ?,
              last_error_message = ?,
              locked_by = NULL,
              locked_at = NULL,
              updated_at = ?
            WHERE id = ?
              AND locked_by = ?
          `,
        )
        .run(
          attempts,
          new Date(now.getTime() + this.retryDelayMs).toISOString(),
          message,
          now.toISOString(),
          job.job_id,
          this.workerId,
        );

      this.verboseLog('technical retry scheduled', {
        jobId: job.job_id,
        rawIncomingEventId: job.raw_incoming_event_id,
        attempts,
        errorMessage: message,
      });
    });
  }

  private verboseLog(message: string, details: Record<string, unknown>): void {
    if (!this.verboseLogs) {
      return;
    }

    this.logger.log(`${message} ${JSON.stringify(details)}`);
  }
}
