import { EntityManager } from 'typeorm';
import type { JsonObject } from '../../../common/json.types';
import {
  OrderEntity,
  RawIncomingEventEntity,
} from '../../../database/entities';
import {
  OrderStatus,
  OrderVersionedField,
  ReasonCode,
  SupportedEventType,
} from '../../types/event.types';
import { EventMoneyService } from '../event-processing/event-money.service';
import type { OrderEventHandlingContext } from '../event-processing/handlers/order-event-handler';
import { OrderApplicationDecisionService } from '../event-processing/order-application-decision.service';
import { OrderFieldVersionService } from '../event-processing/order-field-version.service';
import { OrderLifecycleApplicationService } from '../event-processing/order-lifecycle-application.service';

describe('OrderLifecycleApplicationService', () => {
  it('captures payment once and records the status field version', async () => {
    const update = createUpdateMock();
    const fieldVersions = createFieldVersions();
    const decision = createDecision();
    const context = createContext({
      manager: createManager(update),
      order: createOrder({ status: OrderStatus.Created }),
      payload: { amount: 42.55 },
    });
    const service = createService(decision.service, fieldVersions.service);

    await service.capturePayment(context);

    expect(fieldVersions.canApplyStatus).toHaveBeenCalledWith(context);
    expect(update).toHaveBeenCalledWith(
      { orderId: 'ord-1' },
      expect.objectContaining({
        paidAmountMinor: 4255,
        status: OrderStatus.Paid,
      }),
    );
    expect(fieldVersions.upsertFieldVersion).toHaveBeenCalledWith(
      context.manager,
      'ord-1',
      OrderVersionedField.Status,
      1710001000,
      'evt-1',
    );
    expect(decision.accept).toHaveBeenCalledWith(
      context,
      OrderStatus.Created,
      OrderStatus.Paid,
      {
        paidAmountMinor: 4255,
        status: OrderStatus.Paid,
      },
    );
  });

  it('rejects a repeated payment capture without mutating the order', async () => {
    const update = createUpdateMock();
    const decision = createDecision();
    const service = createService(
      decision.service,
      createFieldVersions().service,
    );
    const context = createContext({
      manager: createManager(update),
      order: createOrder({
        status: OrderStatus.Paid,
        paidAmountMinor: 4255,
      }),
      type: SupportedEventType.PaymentCaptured,
      payload: { amount: 42.55 },
    });

    await service.capturePayment(context);

    expect(update).not.toHaveBeenCalled();
    expect(decision.reject).toHaveBeenCalledWith(
      context,
      ReasonCode.PaymentAlreadyCaptured,
      'Payment was already captured for this order',
    );
  });

  it('marks a refund as partial when less than the captured amount is returned', async () => {
    const update = createUpdateMock();
    const decision = createDecision();
    const context = createContext({
      manager: createManager(update),
      order: createOrder({
        status: OrderStatus.Paid,
        paidAmountMinor: 10000,
      }),
      type: SupportedEventType.RefundIssued,
      payload: { refundAmount: 25 },
    });
    const service = createService(
      decision.service,
      createFieldVersions().service,
    );

    await service.issueRefund(context);

    expect(update).toHaveBeenCalledWith(
      { orderId: 'ord-1' },
      expect.objectContaining({
        refundedAmountMinor: 2500,
        status: OrderStatus.PartiallyRefunded,
      }),
    );
    expect(decision.accept).toHaveBeenCalledWith(
      context,
      OrderStatus.Paid,
      OrderStatus.PartiallyRefunded,
      {
        refundedAmountMinor: 2500,
        status: OrderStatus.PartiallyRefunded,
      },
    );
  });

  it('marks a refund as complete when the remaining captured amount is returned', async () => {
    const update = createUpdateMock();
    const decision = createDecision();
    const context = createContext({
      manager: createManager(update),
      order: createOrder({
        status: OrderStatus.PartiallyRefunded,
        paidAmountMinor: 10000,
        refundedAmountMinor: 2500,
      }),
      type: SupportedEventType.RefundIssued,
      payload: { amount: 75 },
    });
    const service = createService(
      decision.service,
      createFieldVersions().service,
    );

    await service.issueRefund(context);

    expect(update).toHaveBeenCalledWith(
      { orderId: 'ord-1' },
      expect.objectContaining({
        refundedAmountMinor: 10000,
        status: OrderStatus.Refunded,
      }),
    );
    expect(decision.accept).toHaveBeenCalledWith(
      context,
      OrderStatus.PartiallyRefunded,
      OrderStatus.Refunded,
      {
        refundedAmountMinor: 10000,
        status: OrderStatus.Refunded,
      },
    );
  });

  it('rejects refunds above the remaining captured amount', async () => {
    const update = createUpdateMock();
    const decision = createDecision();
    const service = createService(
      decision.service,
      createFieldVersions().service,
    );
    const context = createContext({
      manager: createManager(update),
      order: createOrder({
        status: OrderStatus.PartiallyRefunded,
        paidAmountMinor: 10000,
        refundedAmountMinor: 7500,
      }),
      type: SupportedEventType.RefundIssued,
      payload: { refundAmount: 30 },
    });

    await service.issueRefund(context);

    expect(update).not.toHaveBeenCalled();
    expect(decision.reject).toHaveBeenCalledWith(
      context,
      ReasonCode.RefundExceedsCaptured,
      'Refund amount exceeds captured payment',
    );
  });

  it('rejects an older lifecycle event as obsolete before applying status', async () => {
    const update = createUpdateMock();
    const canApplyStatus = jest
      .fn<
        ReturnType<OrderFieldVersionService['canApplyStatus']>,
        Parameters<OrderFieldVersionService['canApplyStatus']>
      >()
      .mockResolvedValue(false);
    const fieldVersions = createFieldVersions({ canApplyStatus });
    const decision = createDecision();
    const service = createService(decision.service, fieldVersions.service);
    const context = createContext({
      manager: createManager(update),
      order: createOrder({ status: OrderStatus.Created }),
      payload: { amount: 42.55 },
    });

    await service.capturePayment(context);

    expect(update).not.toHaveBeenCalled();
    expect(fieldVersions.upsertFieldVersion).not.toHaveBeenCalled();
    expect(decision.rejectObsoleteStatus).toHaveBeenCalledWith(context);
  });
});

function createService(
  decision: OrderApplicationDecisionService,
  fieldVersions: OrderFieldVersionService,
): OrderLifecycleApplicationService {
  return new OrderLifecycleApplicationService(
    decision,
    fieldVersions,
    new EventMoneyService(),
  );
}

interface DecisionMocks {
  service: OrderApplicationDecisionService;
  accept: jest.Mock<
    ReturnType<OrderApplicationDecisionService['accept']>,
    Parameters<OrderApplicationDecisionService['accept']>
  >;
  reject: jest.Mock<
    ReturnType<OrderApplicationDecisionService['reject']>,
    Parameters<OrderApplicationDecisionService['reject']>
  >;
  retryOrReject: jest.Mock<
    ReturnType<OrderApplicationDecisionService['retryOrReject']>,
    Parameters<OrderApplicationDecisionService['retryOrReject']>
  >;
  rejectObsoleteStatus: jest.Mock<
    ReturnType<OrderApplicationDecisionService['rejectObsoleteStatus']>,
    Parameters<OrderApplicationDecisionService['rejectObsoleteStatus']>
  >;
}

function createDecision(): DecisionMocks {
  const accept = jest
    .fn<
      ReturnType<OrderApplicationDecisionService['accept']>,
      Parameters<OrderApplicationDecisionService['accept']>
    >()
    .mockResolvedValue(undefined);
  const reject = jest
    .fn<
      ReturnType<OrderApplicationDecisionService['reject']>,
      Parameters<OrderApplicationDecisionService['reject']>
    >()
    .mockResolvedValue(undefined);
  const retryOrReject = jest
    .fn<
      ReturnType<OrderApplicationDecisionService['retryOrReject']>,
      Parameters<OrderApplicationDecisionService['retryOrReject']>
    >()
    .mockResolvedValue(undefined);
  const rejectObsoleteStatus = jest
    .fn<
      ReturnType<OrderApplicationDecisionService['rejectObsoleteStatus']>,
      Parameters<OrderApplicationDecisionService['rejectObsoleteStatus']>
    >()
    .mockResolvedValue(undefined);

  return {
    service: Object.assign(
      Object.create(OrderApplicationDecisionService.prototype),
      {
        accept,
        reject,
        retryOrReject,
        rejectObsoleteStatus,
      },
    ) as OrderApplicationDecisionService,
    accept,
    reject,
    retryOrReject,
    rejectObsoleteStatus,
  };
}

interface FieldVersionMocks {
  service: OrderFieldVersionService;
  canApplyStatus: jest.Mock<
    ReturnType<OrderFieldVersionService['canApplyStatus']>,
    Parameters<OrderFieldVersionService['canApplyStatus']>
  >;
  upsertFieldVersion: jest.Mock<
    ReturnType<OrderFieldVersionService['upsertFieldVersion']>,
    Parameters<OrderFieldVersionService['upsertFieldVersion']>
  >;
}

function createFieldVersions(
  overrides: Partial<Omit<FieldVersionMocks, 'service'>> = {},
): FieldVersionMocks {
  const canApplyStatus =
    overrides.canApplyStatus ??
    jest
      .fn<
        ReturnType<OrderFieldVersionService['canApplyStatus']>,
        Parameters<OrderFieldVersionService['canApplyStatus']>
      >()
      .mockResolvedValue(true);
  const upsertFieldVersion =
    overrides.upsertFieldVersion ??
    jest
      .fn<
        ReturnType<OrderFieldVersionService['upsertFieldVersion']>,
        Parameters<OrderFieldVersionService['upsertFieldVersion']>
      >()
      .mockResolvedValue(undefined);

  return {
    service: Object.assign(Object.create(OrderFieldVersionService.prototype), {
      canApplyStatus,
      upsertFieldVersion,
    }) as OrderFieldVersionService,
    canApplyStatus,
    upsertFieldVersion,
  };
}

function createUpdateMock(): jest.Mock<Promise<void>, [object, object]> {
  return jest
    .fn<Promise<void>, [object, object]>()
    .mockResolvedValue(undefined);
}

function createManager(
  update: jest.Mock<Promise<void>, [object, object]>,
): EntityManager {
  return Object.assign(Object.create(EntityManager.prototype), {
    getRepository: jest.fn((entity: object) => {
      if (entity !== OrderEntity) {
        throw new Error('Unexpected repository requested');
      }

      return { update };
    }),
  }) as EntityManager;
}

function createContext({
  manager,
  order,
  payload,
  type = SupportedEventType.PaymentCaptured,
}: {
  manager: EntityManager;
  order: OrderEntity | null;
  payload: JsonObject;
  type?: SupportedEventType;
}): OrderEventHandlingContext {
  return {
    manager,
    order,
    event: {
      eventId: 'evt-1',
      orderId: 'ord-1',
      type,
      timestamp: 1710001000,
      payload,
    },
    delivery: Object.assign(new RawIncomingEventEntity(), {
      id: 10,
      attempts: 0,
    }),
    getProcessingTimeMs: jest.fn().mockResolvedValue(6),
  };
}

function createOrder(overrides: Partial<OrderEntity> = {}): OrderEntity {
  return Object.assign(new OrderEntity(), {
    orderId: 'ord-1',
    status: OrderStatus.Created,
    amountMinor: 4255,
    currency: 'USD',
    paidAmountMinor: 0,
    refundedAmountMinor: 0,
    createdAt: '2026-05-25T10:00:00.000Z',
    updatedAt: '2026-05-25T10:00:00.000Z',
    ...overrides,
  });
}
