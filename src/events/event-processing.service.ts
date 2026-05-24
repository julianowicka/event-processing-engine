import { Injectable } from '@nestjs/common';
import { SqliteService } from '../database/sqlite.service';
import {
  OrderRow,
  OrderStatus,
  ProcessJobOutcome,
  ProcessingJobRow,
  ValidOrderEvent,
} from './event.types';
import { EventAuditRepository } from './processing/event-audit.repository';
import { EventDecisionService } from './processing/event-decision.service';
import { EventJobRepository } from './processing/event-job.repository';
import {
  DecisionDescription,
  FieldChangeSet,
  NextOrderState,
} from './processing/event-processing.types';
import { EventValidationService } from './processing/event-validation.service';
import { OrderMergeService } from './processing/order-merge.service';
import { OrderRepository } from './processing/order.repository';
import { OrderStateMachineService } from './processing/order-state-machine.service';

@Injectable()
export class EventProcessingService {
  private readonly maxAttempts = 3;

  constructor(
    private readonly sqliteService: SqliteService,
    private readonly jobRepository: EventJobRepository,
    private readonly orderRepository: OrderRepository,
    private readonly auditRepository: EventAuditRepository,
    private readonly validationService: EventValidationService,
    private readonly stateMachineService: OrderStateMachineService,
    private readonly mergeService: OrderMergeService,
    private readonly decisionService: EventDecisionService,
  ) {}

  processNextAvailableJob(): ProcessJobOutcome | null {
    const job = this.jobRepository.claimNextAvailableJob();

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

  private processBusinessJob(job: ProcessingJobRow): ProcessJobOutcome {
    const startedAt = Date.now();
    const validation = this.validationService.validateRawEvent(job);

    if (!validation.valid) {
      this.finishWithDecisionDescription(
        job,
        this.validationService.partialEventFromJob(job),
        this.decisionService.invalidEvent(
          validation.reasonCode,
          validation.reasonMessage,
          validation.details,
        ),
        Date.now() - startedAt,
      );
      return { orderChanged: false };
    }

    const event = validation.event;

    if (!this.orderRepository.claimDeduplicationKey(job, event)) {
      this.finishWithDecisionDescription(
        job,
        event,
        this.decisionService.duplicate(event),
        Date.now() - startedAt,
      );
      return { orderChanged: false };
    }

    const order = this.orderRepository.findOrder(event.orderId);

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
      this.finishWithDecisionDescription(
        job,
        event,
        this.decisionService.orderAlreadyExists(event),
        Date.now() - startedAt,
      );
      return { orderChanged: false };
    }

    const amountMinor = this.validationService.optionalMoneyToMinor(
      event.payload.amount,
    );
    const currency = this.validationService.optionalCurrency(
      event.payload.currency,
    );

    this.orderRepository.createOrder(event, amountMinor, currency);
    this.orderRepository.upsertFieldVersion(event.orderId, 'status', event);

    if (amountMinor !== null) {
      this.orderRepository.upsertFieldVersion(
        event.orderId,
        'amountMinor',
        event,
      );
    }

    if (currency !== null) {
      this.orderRepository.upsertFieldVersion(event.orderId, 'currency', event);
    }

    const changed = {
      status: 'CREATED',
      ...(amountMinor === null ? {} : { amountMinor }),
      ...(currency === null ? {} : { currency }),
    };

    this.auditRepository.writeHistory(
      event,
      null,
      'CREATED',
      changed,
      {},
      'ACCEPTED',
      'APPLIED',
    );
    this.finishWithDecisionDescription(
      job,
      event,
      this.decisionService.orderCreated(event, changed),
      Date.now() - startedAt,
    );
    this.jobRepository.releaseDeferredJobsForOrder(event.orderId);

    return { orderChanged: true };
  }

  private processOrderUpdated(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
    order: OrderRow,
    startedAt: number,
  ): ProcessJobOutcome {
    const mutation = this.mergeService.buildOrderUpdatedMutation(
      event,
      order,
      (fieldName) =>
        this.orderRepository.canApplyField(event.orderId, fieldName, event),
    );

    return this.finishStateMutation(
      job,
      event,
      order,
      mutation.nextState,
      mutation.fields,
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
        ? this.validationService.positiveMoneyToMinor(event.payload.amount)
        : order.amount_minor;

    if (paymentAmount === null || paymentAmount <= 0) {
      this.finishWithDecisionDescription(
        job,
        event,
        this.decisionService.paymentAmountRequired(),
        Date.now() - startedAt,
      );
      return { orderChanged: false };
    }

    if (order.paid_amount_minor > 0) {
      this.finishWithDecisionDescription(
        job,
        event,
        this.decisionService.paymentAlreadyCaptured(event),
        Date.now() - startedAt,
      );
      return { orderChanged: false };
    }

    if (!this.stateMachineService.canTransition(order.status, 'PAID')) {
      this.finishWithDecisionDescription(
        job,
        event,
        this.decisionService.forbiddenPayment(event, order),
        Date.now() - startedAt,
      );
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
    if (!this.stateMachineService.canTransition(order.status, 'CANCELLED')) {
      this.finishWithDecisionDescription(
        job,
        event,
        this.decisionService.forbiddenCancellation(event, order),
        Date.now() - startedAt,
      );
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
    const refundAmount =
      this.validationService.positiveMoneyToMinor(amountValue);

    if (refundAmount === null || refundAmount <= 0) {
      this.finishWithDecisionDescription(
        job,
        event,
        this.decisionService.refundAmountRequired(),
        Date.now() - startedAt,
      );
      return { orderChanged: false };
    }

    if (
      order.status === 'CREATED' &&
      this.jobRepository.hasPendingPaymentForOrder(
        event.orderId,
        event.timestamp,
      )
    ) {
      this.deferJob(job, event, Date.now() - startedAt);
      return { orderChanged: false };
    }

    if (order.status !== 'PAID' && order.status !== 'PARTIALLY_REFUNDED') {
      this.finishWithDecisionDescription(
        job,
        event,
        this.decisionService.forbiddenRefund(event, order),
        Date.now() - startedAt,
      );
      return { orderChanged: false };
    }

    const nextRefundedAmount = order.refunded_amount_minor + refundAmount;

    if (nextRefundedAmount > order.paid_amount_minor) {
      this.finishWithDecisionDescription(
        job,
        event,
        this.decisionService.refundExceedsCaptured(event),
        Date.now() - startedAt,
      );
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
    nextState: NextOrderState,
    fields: FieldChangeSet,
    startedAt: number,
  ): ProcessJobOutcome {
    const decision = this.decisionService.stateMutationResult(event, fields);

    if (decision.decision === 'REJECTED') {
      this.finishWithDecisionDescription(
        job,
        event,
        decision,
        Date.now() - startedAt,
      );
      return { orderChanged: false };
    }

    this.orderRepository.updateOrderState(event, nextState);

    for (const fieldName of Object.keys(fields.changed)) {
      this.orderRepository.upsertFieldVersion(event.orderId, fieldName, event);
    }

    const historyDecision =
      decision.decision === 'PARTIALLY_APPLIED'
        ? 'PARTIALLY_APPLIED'
        : 'ACCEPTED';

    this.auditRepository.writeHistory(
      event,
      order.status,
      nextState.status,
      fields.changed,
      fields.skipped,
      historyDecision,
      decision.reasonCode,
    );
    this.finishWithDecisionDescription(
      job,
      event,
      decision,
      Date.now() - startedAt,
    );
    this.jobRepository.releaseDeferredJobsForOrder(event.orderId);

    return { orderChanged: true };
  }

  private finishWithDecisionDescription(
    job: ProcessingJobRow,
    event: Partial<ValidOrderEvent>,
    decision: DecisionDescription,
    processingTimeMs: number,
  ): void {
    const result = this.auditRepository.writeDecision({
      job,
      event,
      decision: decision.decision,
      reasonCode: decision.reasonCode,
      reasonMessage: decision.reasonMessage,
      details: decision.details,
      processingTimeMs,
    });

    if (decision.decision !== 'DEFERRED') {
      this.auditRepository.updateFinalStats(
        decision.decision,
        processingTimeMs,
      );
      this.jobRepository.markFinalDecision(
        job,
        result.decisionId,
        decision.reasonCode,
      );
    }
  }

  private deferJob(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
    processingTimeMs: number,
  ): void {
    const decision = this.decisionService.orderNotReady(event);
    const result = this.auditRepository.writeDecision({
      job,
      event,
      decision: decision.decision,
      reasonCode: decision.reasonCode,
      reasonMessage: decision.reasonMessage,
      processingTimeMs,
    });

    this.jobRepository.markDeferred(job, result.decisionId);
  }

  private recordTechnicalFailure(job: ProcessingJobRow, error: unknown): void {
    this.sqliteService.transaction(() => {
      const attempts = job.attempts + 1;
      const message = error instanceof Error ? error.message : String(error);

      if (attempts >= this.maxAttempts) {
        const decision = this.decisionService.processingError(message);
        const result = this.auditRepository.writeDecision({
          job,
          event: this.validationService.partialEventFromJob(job),
          decision: decision.decision,
          reasonCode: decision.reasonCode,
          reasonMessage: decision.reasonMessage,
          processingTimeMs: 0,
        });

        this.auditRepository.updateFinalStats('FAILED', 0);
        this.auditRepository.insertDeadLetterEvent(job, message, attempts);
        this.jobRepository.markDeadLettered(
          job,
          attempts,
          message,
          result.decisionId,
        );
        return;
      }

      this.jobRepository.scheduleTechnicalRetry(job, attempts, message);
    });
  }
}
