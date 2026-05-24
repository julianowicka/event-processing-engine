import { Injectable } from '@nestjs/common';
import { SqliteService } from '../database/sqlite.service';
import type { ProcessJobOutcome, ProcessingJobRow } from './event.types';
import { EventDecisionService } from './processing/event-decision.service';
import { EventJobCompletionService } from './processing/event-job-completion.service';
import { EventJobRepository } from './processing/event-job.repository';
import { EventValidationService } from './processing/event-validation.service';
import { OrderRepository } from './processing/order.repository';
import { OrderEventStateMachineService } from './processing/state-machine/order-event-state-machine.service';

@Injectable()
export class EventProcessingService {
  constructor(
    private readonly sqliteService: SqliteService,
    private readonly jobRepository: EventJobRepository,
    private readonly orderRepository: OrderRepository,
    private readonly validationService: EventValidationService,
    private readonly orderEventStateMachine: OrderEventStateMachineService,
    private readonly decisionService: EventDecisionService,
    private readonly completionService: EventJobCompletionService,
  ) {}

  processNextAvailableJob(): ProcessJobOutcome | null {
    const job = this.jobRepository.claimNextAvailableJob();

    if (!job) {
      return null;
    }

    try {
      return this.sqliteService.transaction(() => this.processBusinessJob(job));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.completionService.recordTechnicalFailure(job, message);
      return { orderChanged: false };
    }
  }

  private processBusinessJob(job: ProcessingJobRow): ProcessJobOutcome {
    const startedAt = Date.now();
    const validation = this.validationService.validateRawEvent(job);

    if (!validation.valid) {
      this.completionService.completeFinalDecision(
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
      this.completionService.completeFinalDecision(
        job,
        event,
        this.decisionService.duplicate(event),
        Date.now() - startedAt,
      );
      return { orderChanged: false };
    }

    const result = this.orderEventStateMachine.apply(event, {
      order: this.orderRepository.findOrder(event.orderId),
      canApplyField: (fieldName) =>
        this.orderRepository.canApplyField(event.orderId, fieldName, event),
      hasPendingPaymentForOrder: () =>
        this.jobRepository.hasPendingPaymentForOrder(
          event.orderId,
          event.timestamp,
        ),
    });

    return this.completionService.completeResult(
      job,
      event,
      result,
      Date.now() - startedAt,
    );
  }
}
