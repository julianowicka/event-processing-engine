import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DatabaseService } from '../../database/database.service';
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
    private readonly databaseService: DatabaseService,
    private readonly jobRepository: EventJobRepository,
    private readonly orderRepository: OrderRepository,
    private readonly auditRepository: EventAuditRepository,
    private readonly validationService: EventValidationService,
    private readonly decisionService: EventDecisionService,
  ) {}

  async completeResult(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
    result: OrderEventStateMachineResult,
    processingTimeMs: number,
    manager: EntityManager,
  ): Promise<ProcessJobOutcome> {
    switch (result.kind) {
      case OrderEventStateMachineResultKind.Created:
        return this.completeOrderCreated(
          job,
          event,
          result,
          processingTimeMs,
          manager,
        );
      case OrderEventStateMachineResultKind.Mutation:
        return this.completeMutation(
          job,
          event,
          result,
          processingTimeMs,
          manager,
        );
      case OrderEventStateMachineResultKind.Rejected:
        await this.completeFinalDecision(
          job,
          event,
          result.decision,
          processingTimeMs,
          manager,
        );
        return { orderChanged: false };
      case OrderEventStateMachineResultKind.Deferred:
        await this.completeDeferred(
          job,
          event,
          result.decision,
          processingTimeMs,
          manager,
        );
        return { orderChanged: false };
    }
  }

  async completeFinalDecision(
    job: ProcessingJobRow,
    event: Partial<ValidOrderEvent>,
    decision: DecisionDescription,
    processingTimeMs: number,
    manager: EntityManager,
  ): Promise<void> {
    const result = await this.auditRepository.writeDecision(
      {
        job,
        event,
        decision: decision.decision,
        reasonCode: decision.reasonCode,
        reasonMessage: decision.reasonMessage,
        details: decision.details,
        processingTimeMs,
      },
      manager,
    );

    await this.auditRepository.updateFinalStats(
      decision.decision,
      processingTimeMs,
      manager,
    );
    await this.jobRepository.markFinalDecision(
      job,
      result.decisionId,
      decision.reasonCode,
      manager,
    );
  }

  recordTechnicalFailure(
    job: ProcessingJobRow,
    errorMessage: string,
  ): Promise<void> {
    return this.databaseService.transaction(async (manager) => {
      const attempts = job.attempts + 1;

      if (attempts < this.maxAttempts) {
        await this.jobRepository.scheduleTechnicalRetry(
          job,
          attempts,
          errorMessage,
          manager,
        );
        return;
      }

      const decision = this.decisionService.processingError(errorMessage);
      const result = await this.auditRepository.writeDecision(
        {
          job,
          event: this.validationService.partialEventFromJob(job),
          decision: decision.decision,
          reasonCode: decision.reasonCode,
          reasonMessage: decision.reasonMessage,
          processingTimeMs: 0,
        },
        manager,
      );

      await this.auditRepository.updateFinalStats(
        EngineDecision.Failed,
        0,
        manager,
      );
      await this.auditRepository.insertDeadLetterEvent(
        job,
        errorMessage,
        attempts,
        manager,
      );
      await this.jobRepository.markDeadLettered(
        job,
        attempts,
        errorMessage,
        result.decisionId,
        manager,
      );
    });
  }

  private async completeOrderCreated(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
    result: Extract<
      OrderEventStateMachineResult,
      { kind: OrderEventStateMachineResultKind.Created }
    >,
    processingTimeMs: number,
    manager: EntityManager,
  ): Promise<ProcessJobOutcome> {
    const createdOrder = result.createdOrder;

    await this.orderRepository.createOrder(
      event,
      createdOrder.amountMinor,
      createdOrder.currency,
      manager,
    );
    await this.orderRepository.upsertFieldVersion(
      event.orderId,
      OrderVersionedField.Status,
      event,
      manager,
    );

    if (createdOrder.amountMinor !== null) {
      await this.orderRepository.upsertFieldVersion(
        event.orderId,
        OrderVersionedField.AmountMinor,
        event,
        manager,
      );
    }

    if (createdOrder.currency !== null) {
      await this.orderRepository.upsertFieldVersion(
        event.orderId,
        OrderVersionedField.Currency,
        event,
        manager,
      );
    }

    await this.auditRepository.writeHistory(
      event,
      null,
      OrderStatus.Created,
      createdOrder.changedFields,
      {},
      result.decision.decision,
      result.decision.reasonCode,
      manager,
    );
    await this.completeFinalDecision(
      job,
      event,
      result.decision,
      processingTimeMs,
      manager,
    );
    await this.jobRepository.releaseDeferredJobsForOrder(
      event.orderId,
      manager,
    );

    return { orderChanged: true };
  }

  private async completeMutation(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
    result: Extract<
      OrderEventStateMachineResult,
      { kind: OrderEventStateMachineResultKind.Mutation }
    >,
    processingTimeMs: number,
    manager: EntityManager,
  ): Promise<ProcessJobOutcome> {
    await this.orderRepository.updateOrderState(
      event,
      result.nextState,
      manager,
    );

    for (const fieldName of Object.keys(
      result.fields.changed,
    ) as OrderVersionedField[]) {
      await this.orderRepository.upsertFieldVersion(
        event.orderId,
        fieldName,
        event,
        manager,
      );
    }

    await this.auditRepository.writeHistory(
      event,
      result.order.status,
      result.nextState.status,
      result.fields.changed,
      result.fields.skipped,
      result.decision.decision,
      result.decision.reasonCode,
      manager,
    );
    await this.completeFinalDecision(
      job,
      event,
      result.decision,
      processingTimeMs,
      manager,
    );
    await this.jobRepository.releaseDeferredJobsForOrder(
      event.orderId,
      manager,
    );

    return { orderChanged: true };
  }

  private async completeDeferred(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
    decision: DecisionDescription,
    processingTimeMs: number,
    manager: EntityManager,
  ): Promise<void> {
    const result = await this.auditRepository.writeDecision(
      {
        job,
        event,
        decision: decision.decision,
        reasonCode: decision.reasonCode,
        reasonMessage: decision.reasonMessage,
        processingTimeMs,
      },
      manager,
    );

    await this.jobRepository.markDeferred(job, result.decisionId, manager);
  }
}
