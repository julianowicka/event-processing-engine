import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DatabaseService } from '../database/database.service';
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
    private readonly databaseService: DatabaseService,
    private readonly jobRepository: EventJobRepository,
    private readonly orderRepository: OrderRepository,
    private readonly validationService: EventValidationService,
    private readonly orderEventStateMachine: OrderEventStateMachineService,
    private readonly decisionService: EventDecisionService,
    private readonly completionService: EventJobCompletionService,
  ) {}

  async processNextAvailableJob(): Promise<ProcessJobOutcome | null> {
    const job = await this.jobRepository.claimNextAvailableJob();

    if (!job) {
      return null;
    }

    try {
      return await this.databaseService.transaction((manager) =>
        this.processBusinessJob(job, manager),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.completionService.recordTechnicalFailure(job, message);
      return { orderChanged: false };
    }
  }

  private async processBusinessJob(
    job: ProcessingJobRow,
    manager: EntityManager,
  ): Promise<ProcessJobOutcome> {
    const startedAt = Date.now();
    const validation = this.validationService.validateRawEvent(job);

    if (!validation.valid) {
      await this.completionService.completeFinalDecision(
        job,
        this.validationService.partialEventFromJob(job),
        this.decisionService.invalidEvent(
          validation.reasonCode,
          validation.reasonMessage,
          validation.details,
        ),
        Date.now() - startedAt,
        manager,
      );
      return { orderChanged: false };
    }

    const event = validation.event;

    if (
      !(await this.orderRepository.claimDeduplicationKey(job, event, manager))
    ) {
      await this.completionService.completeFinalDecision(
        job,
        event,
        this.decisionService.duplicate(event),
        Date.now() - startedAt,
        manager,
      );
      return { orderChanged: false };
    }

    const order = await this.orderRepository.findOrder(event.orderId, manager);
    const applicableFields = await this.orderRepository.findApplicableFields(
      event.orderId,
      event,
      manager,
    );
    const hasPendingPayment =
      await this.jobRepository.hasPendingPaymentForOrder(
        event.orderId,
        event.timestamp,
        manager,
      );
    const result = this.orderEventStateMachine.apply(event, {
      order,
      canApplyField: (fieldName) => applicableFields.has(fieldName),
      hasPendingPaymentForOrder: () => hasPendingPayment,
    });

    return this.completionService.completeResult(
      job,
      event,
      result,
      Date.now() - startedAt,
      manager,
    );
  }
}
