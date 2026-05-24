import { Injectable } from '@nestjs/common';
import { SqliteService } from '../../database/sqlite.service';
import {
  EngineDecision,
  OrderStatus,
  OrderVersionedField,
  type ProcessJobOutcome,
  type ProcessingJobRow,
  type ValidOrderEvent,
} from '../event.types';
import { EventAuditRepository } from './event-audit.repository';
import { EventDecisionService } from './event-decision.service';
import { EventJobRepository } from './event-job.repository';
import {
  OrderEventStateMachineResultKind,
  type DecisionDescription,
  type OrderEventStateMachineResult,
} from './event-processing.types';
import { EventValidationService } from './event-validation.service';
import { OrderRepository } from './order.repository';

@Injectable()
export class EventJobCompletionService {
  private readonly maxAttempts = 3;

  constructor(
    private readonly sqliteService: SqliteService,
    private readonly jobRepository: EventJobRepository,
    private readonly orderRepository: OrderRepository,
    private readonly auditRepository: EventAuditRepository,
    private readonly validationService: EventValidationService,
    private readonly decisionService: EventDecisionService,
  ) {}

  completeResult(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
    result: OrderEventStateMachineResult,
    processingTimeMs: number,
  ): ProcessJobOutcome {
    switch (result.kind) {
      case OrderEventStateMachineResultKind.Created:
        return this.completeOrderCreated(job, event, result, processingTimeMs);
      case OrderEventStateMachineResultKind.Mutation:
        return this.completeMutation(job, event, result, processingTimeMs);
      case OrderEventStateMachineResultKind.Rejected:
        this.completeFinalDecision(
          job,
          event,
          result.decision,
          processingTimeMs,
        );
        return { orderChanged: false };
      case OrderEventStateMachineResultKind.Deferred:
        this.completeDeferred(job, event, result.decision, processingTimeMs);
        return { orderChanged: false };
    }
  }

  completeFinalDecision(
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

    this.auditRepository.updateFinalStats(decision.decision, processingTimeMs);
    this.jobRepository.markFinalDecision(
      job,
      result.decisionId,
      decision.reasonCode,
    );
  }

  recordTechnicalFailure(job: ProcessingJobRow, errorMessage: string): void {
    this.sqliteService.transaction(() => {
      const attempts = job.attempts + 1;

      if (attempts < this.maxAttempts) {
        this.jobRepository.scheduleTechnicalRetry(job, attempts, errorMessage);
        return;
      }

      const decision = this.decisionService.processingError(errorMessage);
      const result = this.auditRepository.writeDecision({
        job,
        event: this.validationService.partialEventFromJob(job),
        decision: decision.decision,
        reasonCode: decision.reasonCode,
        reasonMessage: decision.reasonMessage,
        processingTimeMs: 0,
      });

      this.auditRepository.updateFinalStats(EngineDecision.Failed, 0);
      this.auditRepository.insertDeadLetterEvent(job, errorMessage, attempts);
      this.jobRepository.markDeadLettered(
        job,
        attempts,
        errorMessage,
        result.decisionId,
      );
    });
  }

  private completeOrderCreated(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
    result: Extract<
      OrderEventStateMachineResult,
      { kind: OrderEventStateMachineResultKind.Created }
    >,
    processingTimeMs: number,
  ): ProcessJobOutcome {
    const createdOrder = result.createdOrder;

    this.orderRepository.createOrder(
      event,
      createdOrder.amountMinor,
      createdOrder.currency,
    );
    this.orderRepository.upsertFieldVersion(
      event.orderId,
      OrderVersionedField.Status,
      event,
    );

    if (createdOrder.amountMinor !== null) {
      this.orderRepository.upsertFieldVersion(
        event.orderId,
        OrderVersionedField.AmountMinor,
        event,
      );
    }

    if (createdOrder.currency !== null) {
      this.orderRepository.upsertFieldVersion(
        event.orderId,
        OrderVersionedField.Currency,
        event,
      );
    }

    this.auditRepository.writeHistory(
      event,
      null,
      OrderStatus.Created,
      createdOrder.changedFields,
      {},
      result.decision.decision,
      result.decision.reasonCode,
    );
    this.completeFinalDecision(job, event, result.decision, processingTimeMs);
    this.jobRepository.releaseDeferredJobsForOrder(event.orderId);

    return { orderChanged: true };
  }

  private completeMutation(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
    result: Extract<
      OrderEventStateMachineResult,
      { kind: OrderEventStateMachineResultKind.Mutation }
    >,
    processingTimeMs: number,
  ): ProcessJobOutcome {
    this.orderRepository.updateOrderState(event, result.nextState);

    for (const fieldName of Object.keys(
      result.fields.changed,
    ) as OrderVersionedField[]) {
      this.orderRepository.upsertFieldVersion(event.orderId, fieldName, event);
    }

    this.auditRepository.writeHistory(
      event,
      result.order.status,
      result.nextState.status,
      result.fields.changed,
      result.fields.skipped,
      result.decision.decision,
      result.decision.reasonCode,
    );
    this.completeFinalDecision(job, event, result.decision, processingTimeMs);
    this.jobRepository.releaseDeferredJobsForOrder(event.orderId);

    return { orderChanged: true };
  }

  private completeDeferred(
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
}
