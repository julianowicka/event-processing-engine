import { Test } from '@nestjs/testing';
import type { EntityManager } from 'typeorm';
import { DatabaseService } from '../../../database/database.service';
import {
  EngineDecision,
  JobStatus,
  OrderStatus,
  ReasonCode,
  SupportedEventType,
} from '../../event.types';
import type {
  OrderRow,
  ProcessingJobRow,
  ValidOrderEvent,
} from '../../event.types';
import { EventAuditRepository } from '../event-audit.repository';
import { EventDecisionService } from '../event-decision.service';
import { EventJobCompletionService } from '../event-job-completion.service';
import { EventJobRepository } from '../event-job.repository';
import { OrderEventStateMachineResultKind } from '../event-processing.types';
import { EventValidationService } from '../event-validation.service';
import { OrderRepository } from '../order.repository';

describe('EventJobCompletionService', () => {
  let databaseService: { transaction: jest.Mock };
  let jobRepository: {
    markFinalDecision: jest.Mock;
    markDeferred: jest.Mock;
    releaseDeferredJobsForOrder: jest.Mock;
    scheduleTechnicalRetry: jest.Mock;
    markDeadLettered: jest.Mock;
  };
  let orderRepository: {
    createOrder: jest.Mock;
    updateOrderState: jest.Mock;
    upsertFieldVersion: jest.Mock;
  };
  let auditRepository: {
    writeDecision: jest.Mock;
    updateFinalStats: jest.Mock;
    writeHistory: jest.Mock;
    insertDeadLetterEvent: jest.Mock;
  };
  let validationService: { partialEventFromJob: jest.Mock };
  let service: EventJobCompletionService;
  const decisionService = new EventDecisionService();
  const manager = {} as EntityManager;

  beforeEach(async () => {
    databaseService = {
      transaction: jest.fn(
        (action: (entityManager: EntityManager) => Promise<void>) =>
          action(manager),
      ),
    };
    jobRepository = {
      markFinalDecision: jest.fn(),
      markDeferred: jest.fn(),
      releaseDeferredJobsForOrder: jest.fn(),
      scheduleTechnicalRetry: jest.fn(),
      markDeadLettered: jest.fn(),
    };
    orderRepository = {
      createOrder: jest.fn(),
      updateOrderState: jest.fn(),
      upsertFieldVersion: jest.fn(),
    };
    auditRepository = {
      writeDecision: jest.fn().mockResolvedValue({ decisionId: 17 }),
      updateFinalStats: jest.fn(),
      writeHistory: jest.fn(),
      insertDeadLetterEvent: jest.fn(),
    };
    validationService = {
      partialEventFromJob: jest.fn(() => ({
        eventId: job().event_id ?? undefined,
      })),
    };

    const module = await Test.createTestingModule({
      providers: [
        EventJobCompletionService,
        { provide: DatabaseService, useValue: databaseService },
        { provide: EventJobRepository, useValue: jobRepository },
        { provide: OrderRepository, useValue: orderRepository },
        { provide: EventAuditRepository, useValue: auditRepository },
        { provide: EventValidationService, useValue: validationService },
        { provide: EventDecisionService, useValue: decisionService },
      ],
    }).compile();

    service = module.get(EventJobCompletionService);
  });

  it('persists accepted order creation and releases deferred jobs', async () => {
    const eventItem = event(SupportedEventType.OrderCreated);
    const changedFields = {
      status: OrderStatus.Created,
      amountMinor: 10000,
      currency: 'PLN',
    };
    const decision = decisionService.orderCreated(eventItem, changedFields);

    await expect(
      service.completeResult(
        job(),
        eventItem,
        {
          kind: OrderEventStateMachineResultKind.Created,
          createdOrder: {
            amountMinor: 10000,
            currency: 'PLN',
            changedFields,
          },
          decision,
        },
        8,
        manager,
      ),
    ).resolves.toEqual({ orderChanged: true });

    expect(orderRepository.createOrder).toHaveBeenCalledWith(
      eventItem,
      10000,
      'PLN',
      manager,
    );
    expect(orderRepository.upsertFieldVersion).toHaveBeenCalledTimes(3);
    expect(auditRepository.writeHistory).toHaveBeenCalledWith(
      eventItem,
      null,
      OrderStatus.Created,
      expect.any(Object),
      {},
      EngineDecision.Accepted,
      ReasonCode.Applied,
      manager,
    );
    expect(jobRepository.markFinalDecision).toHaveBeenCalledWith(
      expect.any(Object),
      17,
      ReasonCode.Applied,
      manager,
    );
    expect(jobRepository.releaseDeferredJobsForOrder).toHaveBeenCalledWith(
      eventItem.orderId,
      manager,
    );
  });

  it('persists a partially applied mutation with its evaluated decision', async () => {
    const eventItem = event(SupportedEventType.OrderUpdated);
    const fields = {
      changed: { currency: 'EUR' },
      skipped: { amountMinor: ReasonCode.ObsoleteField },
    };
    const decision = decisionService.stateMutationResult(eventItem, fields);

    expect(decision.decision).toBe(EngineDecision.PartiallyApplied);

    if (decision.decision === EngineDecision.Rejected) {
      throw new Error('Expected a partially applied decision');
    }

    await service.completeResult(
      job(),
      eventItem,
      {
        kind: OrderEventStateMachineResultKind.Mutation,
        order: order(),
        nextState: {
          status: OrderStatus.Created,
          amountMinor: 10000,
          currency: 'EUR',
          paidAmountMinor: 0,
          refundedAmountMinor: 0,
        },
        fields,
        decision,
      },
      5,
      manager,
    );

    expect(orderRepository.updateOrderState).toHaveBeenCalled();
    expect(orderRepository.upsertFieldVersion).toHaveBeenCalledTimes(1);
    expect(auditRepository.writeHistory).toHaveBeenCalledWith(
      eventItem,
      OrderStatus.Created,
      OrderStatus.Created,
      fields.changed,
      fields.skipped,
      EngineDecision.PartiallyApplied,
      ReasonCode.PartialMerge,
      manager,
    );
    expect(auditRepository.updateFinalStats).toHaveBeenCalledWith(
      EngineDecision.PartiallyApplied,
      5,
      manager,
    );
  });

  it('finalizes duplicates but leaves deferred outcomes retryable', async () => {
    const eventItem = event(SupportedEventType.PaymentCaptured);

    await service.completeFinalDecision(
      job(),
      eventItem,
      decisionService.duplicate(eventItem),
      2,
      manager,
    );

    expect(jobRepository.markFinalDecision).toHaveBeenCalledWith(
      expect.any(Object),
      17,
      ReasonCode.DuplicateEvent,
      manager,
    );

    jest.clearAllMocks();
    auditRepository.writeDecision.mockResolvedValue({ decisionId: 18 });

    await expect(
      service.completeResult(
        job(),
        eventItem,
        {
          kind: OrderEventStateMachineResultKind.Deferred,
          decision: decisionService.orderNotReady(eventItem),
        },
        3,
        manager,
      ),
    ).resolves.toEqual({ orderChanged: false });

    expect(jobRepository.markDeferred).toHaveBeenCalledWith(
      expect.any(Object),
      18,
      manager,
    );
    expect(auditRepository.updateFinalStats).not.toHaveBeenCalled();
    expect(jobRepository.markFinalDecision).not.toHaveBeenCalled();
  });

  it('schedules retry before storing the final technical failure in DLQ', async () => {
    await service.recordTechnicalFailure(job(), 'temporary failure');

    expect(jobRepository.scheduleTechnicalRetry).toHaveBeenCalledWith(
      expect.any(Object),
      1,
      'temporary failure',
      manager,
    );
    expect(auditRepository.insertDeadLetterEvent).not.toHaveBeenCalled();

    await service.recordTechnicalFailure(
      job({ attempts: 2 }),
      'terminal failure',
    );

    expect(validationService.partialEventFromJob).toHaveBeenCalled();
    expect(auditRepository.updateFinalStats).toHaveBeenCalledWith(
      EngineDecision.Failed,
      0,
      manager,
    );
    expect(auditRepository.insertDeadLetterEvent).toHaveBeenCalledWith(
      expect.any(Object),
      'terminal failure',
      3,
      manager,
    );
    expect(jobRepository.markDeadLettered).toHaveBeenCalledWith(
      expect.any(Object),
      3,
      'terminal failure',
      17,
      manager,
    );
  });

  function event(type: SupportedEventType): ValidOrderEvent {
    return {
      eventId: `evt-${type.toLowerCase()}`,
      orderId: 'ord-completion-001',
      type,
      timestamp: 1710002000,
      payload: {},
    };
  }

  function job(overrides: Partial<ProcessingJobRow> = {}): ProcessingJobRow {
    return {
      job_id: 1,
      raw_incoming_event_id: 1,
      status: JobStatus.Pending,
      attempts: 0,
      locked_by: 'worker',
      locked_at: '2026-05-24T00:00:00.000Z',
      raw_event_json: '{}',
      event_id: 'evt-completion-001',
      order_id: 'ord-completion-001',
      type: SupportedEventType.OrderCreated,
      event_timestamp: 1710002000,
      ...overrides,
    };
  }

  function order(): OrderRow {
    return {
      order_id: 'ord-completion-001',
      status: OrderStatus.Created,
      amount_minor: 10000,
      currency: 'PLN',
      paid_amount_minor: 0,
      refunded_amount_minor: 0,
      version: 1,
      max_accepted_event_timestamp: 1710001000,
      last_accepted_event_id: 'evt-create-001',
      created_at: '2026-05-24T00:00:00.000Z',
      updated_at: '2026-05-24T00:00:00.000Z',
    };
  }
});
