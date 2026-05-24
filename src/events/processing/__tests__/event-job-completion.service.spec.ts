import { SqliteService } from '../../../database/sqlite.service';
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
  let sqliteService: { transaction: jest.Mock };
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

  beforeEach(() => {
    sqliteService = {
      transaction: jest.fn((action: () => unknown) => action()),
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
      writeDecision: jest.fn((_input: unknown) => ({ decisionId: 17 })),
      updateFinalStats: jest.fn(),
      writeHistory: jest.fn(),
      insertDeadLetterEvent: jest.fn(),
    };
    validationService = {
      partialEventFromJob: jest.fn((_job: unknown) => ({
        eventId: job().event_id ?? undefined,
      })),
    };

    service = new EventJobCompletionService(
      sqliteService as unknown as SqliteService,
      jobRepository as unknown as EventJobRepository,
      orderRepository as unknown as OrderRepository,
      auditRepository as unknown as EventAuditRepository,
      validationService as unknown as EventValidationService,
      decisionService,
    );
  });

  it('persists accepted order creation and releases deferred jobs', () => {
    const eventItem = event(SupportedEventType.OrderCreated);
    const changedFields = {
      status: OrderStatus.Created,
      amountMinor: 10000,
      currency: 'PLN',
    };
    const decision = decisionService.orderCreated(eventItem, changedFields);

    expect(
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
      ),
    ).toEqual({ orderChanged: true });

    expect(orderRepository.createOrder).toHaveBeenCalledWith(
      eventItem,
      10000,
      'PLN',
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
    );
    expect(jobRepository.markFinalDecision).toHaveBeenCalledWith(
      expect.any(Object),
      17,
      ReasonCode.Applied,
    );
    expect(jobRepository.releaseDeferredJobsForOrder).toHaveBeenCalledWith(
      eventItem.orderId,
    );
  });

  it('persists a partially applied mutation with its evaluated decision', () => {
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

    service.completeResult(
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
    );
    expect(auditRepository.updateFinalStats).toHaveBeenCalledWith(
      EngineDecision.PartiallyApplied,
      5,
    );
  });

  it('finalizes duplicates but leaves deferred outcomes retryable', () => {
    const eventItem = event(SupportedEventType.PaymentCaptured);

    service.completeFinalDecision(
      job(),
      eventItem,
      decisionService.duplicate(eventItem),
      2,
    );

    expect(jobRepository.markFinalDecision).toHaveBeenCalledWith(
      expect.any(Object),
      17,
      ReasonCode.DuplicateEvent,
    );

    jest.clearAllMocks();
    auditRepository.writeDecision.mockReturnValue({ decisionId: 18 });

    expect(
      service.completeResult(
        job(),
        eventItem,
        {
          kind: OrderEventStateMachineResultKind.Deferred,
          decision: decisionService.orderNotReady(eventItem),
        },
        3,
      ),
    ).toEqual({ orderChanged: false });

    expect(jobRepository.markDeferred).toHaveBeenCalledWith(
      expect.any(Object),
      18,
    );
    expect(auditRepository.updateFinalStats).not.toHaveBeenCalled();
    expect(jobRepository.markFinalDecision).not.toHaveBeenCalled();
  });

  it('schedules retry before storing the final technical failure in DLQ', () => {
    service.recordTechnicalFailure(job(), 'temporary failure');

    expect(jobRepository.scheduleTechnicalRetry).toHaveBeenCalledWith(
      expect.any(Object),
      1,
      'temporary failure',
    );
    expect(auditRepository.insertDeadLetterEvent).not.toHaveBeenCalled();

    service.recordTechnicalFailure(job({ attempts: 2 }), 'terminal failure');

    expect(validationService.partialEventFromJob).toHaveBeenCalled();
    expect(auditRepository.updateFinalStats).toHaveBeenCalledWith(
      EngineDecision.Failed,
      0,
    );
    expect(auditRepository.insertDeadLetterEvent).toHaveBeenCalledWith(
      expect.any(Object),
      'terminal failure',
      3,
    );
    expect(jobRepository.markDeadLettered).toHaveBeenCalledWith(
      expect.any(Object),
      3,
      'terminal failure',
      17,
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
