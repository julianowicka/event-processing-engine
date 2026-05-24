import { Injectable } from '@nestjs/common';
import { SqliteService } from '../database/sqlite.service';
import {
  OrderRow,
  ProcessJobOutcome,
  ProcessingJobRow,
  ValidOrderEvent,
} from './event.types';
import { EventAuditRepository } from './processing/event-audit.repository';
import { EventDecisionService } from './processing/event-decision.service';
import { EventJobRepository } from './processing/event-job.repository';
import {
  CreatedOrderApplication,
  DecisionDescription,
  FieldChangeSet,
  NextOrderState,
  OrderEventApplicationResult,
} from './processing/event-processing.types';
import { EventValidationService } from './processing/event-validation.service';
import { OrderEventApplicationService } from './processing/order-event-application.service';
import { OrderRepository } from './processing/order.repository';

@Injectable()
export class EventProcessingService {
  private readonly maxAttempts = 3;

  constructor(
    private readonly sqliteService: SqliteService,
    private readonly jobRepository: EventJobRepository,
    private readonly orderRepository: OrderRepository,
    private readonly auditRepository: EventAuditRepository,
    private readonly validationService: EventValidationService,
    private readonly orderApplicationService: OrderEventApplicationService,
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
      this.finishDeferredJob(
        job,
        event,
        this.decisionService.orderNotReady(event),
        Date.now() - startedAt,
      );
      return { orderChanged: false };
    }

    const result = this.orderApplicationService.apply(event, {
      order,
      canApplyField: (fieldName) =>
        this.orderRepository.canApplyField(event.orderId, fieldName, event),
      hasPendingPaymentForOrder: () =>
        this.jobRepository.hasPendingPaymentForOrder(
          event.orderId,
          event.timestamp,
        ),
    });

    return this.finishApplicationResult(job, event, result, startedAt);
  }

  private finishApplicationResult(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
    result: OrderEventApplicationResult,
    startedAt: number,
  ): ProcessJobOutcome {
    switch (result.kind) {
      case 'CREATED':
        return this.finishOrderCreated(
          job,
          event,
          result.createdOrder,
          startedAt,
        );
      case 'MUTATION':
        return this.finishStateMutation(
          job,
          event,
          result.order,
          result.nextState,
          result.fields,
          startedAt,
        );
      case 'REJECTED':
        this.finishWithDecisionDescription(
          job,
          event,
          result.decision,
          Date.now() - startedAt,
        );
        return { orderChanged: false };
      case 'DEFERRED':
        this.finishDeferredJob(
          job,
          event,
          result.decision,
          Date.now() - startedAt,
        );
        return { orderChanged: false };
    }
  }

  private finishOrderCreated(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
    createdOrder: CreatedOrderApplication,
    startedAt: number,
  ): ProcessJobOutcome {
    this.orderRepository.createOrder(
      event,
      createdOrder.amountMinor,
      createdOrder.currency,
    );
    this.orderRepository.upsertFieldVersion(event.orderId, 'status', event);

    if (createdOrder.amountMinor !== null) {
      this.orderRepository.upsertFieldVersion(
        event.orderId,
        'amountMinor',
        event,
      );
    }

    if (createdOrder.currency !== null) {
      this.orderRepository.upsertFieldVersion(event.orderId, 'currency', event);
    }

    this.auditRepository.writeHistory(
      event,
      null,
      'CREATED',
      createdOrder.changedFields,
      {},
      'ACCEPTED',
      'APPLIED',
    );
    this.finishWithDecisionDescription(
      job,
      event,
      this.decisionService.orderCreated(event, createdOrder.changedFields),
      Date.now() - startedAt,
    );
    this.jobRepository.releaseDeferredJobsForOrder(event.orderId);

    return { orderChanged: true };
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

  private finishDeferredJob(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
    decision: DecisionDescription,
    processingTimeMs: number,
  ): void {
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
