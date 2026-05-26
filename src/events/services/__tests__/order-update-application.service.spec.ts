import { EntityManager } from 'typeorm';
import type { JsonObject } from '../../../common/json.types';
import {
  OrderEntity,
  RawIncomingEventEntity,
} from '../../../database/entities';
import {
  EngineDecision,
  OrderStatus,
  OrderVersionedField,
  ReasonCode,
  SupportedEventType,
} from '../../types/event.types';
import { EventDecisionWriterService } from '../event-processing/event-decision-writer.service';
import { EventMoneyService } from '../event-processing/event-money.service';
import type { OrderEventHandlingContext } from '../event-processing/handlers/order-event-handler';
import { OrderApplicationDecisionService } from '../event-processing/order-application-decision.service';
import { OrderFieldVersionService } from '../event-processing/order-field-version.service';
import { OrderPayloadReaderService } from '../event-processing/order-payload-reader.service';
import { OrderUpdateApplicationService } from '../event-processing/order-update-application.service';

describe('OrderUpdateApplicationService', () => {
  it('partially merges fresh fields while reporting stale fields and forbidden status updates', async () => {
    const update = createUpdateMock();
    const decisionWriter = createDecisionWriter();
    const fieldVersions = createFieldVersions((fieldName) =>
      fieldName === OrderVersionedField.Currency
        ? Promise.resolve(true)
        : Promise.resolve(false),
    );
    const context = createContext({
      manager: createManager(update),
      payload: {
        amount: 99,
        currency: ' EUR ',
        status: OrderStatus.Cancelled,
      },
    });
    const service = createService(
      createDecision().service,
      decisionWriter.service,
      fieldVersions.service,
    );

    await service.updateOrderFields(context);

    expect(update).toHaveBeenCalledWith(
      { orderId: 'ord-1' },
      expect.objectContaining({
        currency: 'EUR',
      }),
    );
    expect(update.mock.calls[0][1]).not.toHaveProperty('amountMinor');
    expect(fieldVersions.upsertFieldVersion).toHaveBeenCalledTimes(1);
    expect(fieldVersions.upsertFieldVersion).toHaveBeenCalledWith(
      context.manager,
      'ord-1',
      OrderVersionedField.Currency,
      1710001000,
      'evt-update-1',
    );
    expect(decisionWriter.writeFinalDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: context.delivery,
        decision: EngineDecision.PartiallyApplied,
        reasonCode: ReasonCode.PartialMerge,
        fromStatus: OrderStatus.Paid,
        toStatus: OrderStatus.Paid,
        changedFields: {
          currency: 'EUR',
        },
        skippedFields: {
          amountMinor: ReasonCode.ObsoleteField,
          status: ReasonCode.ForbiddenTransition,
        },
        processingTimeMs: 8,
      }),
    );
  });

  it('rejects an update when every supplied field is stale or forbidden', async () => {
    const update = createUpdateMock();
    const decision = createDecision();
    const context = createContext({
      manager: createManager(update),
      payload: {
        amount: 99,
        status: OrderStatus.Cancelled,
      },
    });
    const service = createService(
      decision.service,
      createDecisionWriter().service,
      createFieldVersions(() => Promise.resolve(false)).service,
    );

    await service.updateOrderFields(context);

    expect(update).not.toHaveBeenCalled();
    expect(decision.reject).toHaveBeenCalledWith(
      context,
      ReasonCode.NoApplicableChanges,
      'ORDER_UPDATED did not contain any applicable field changes',
      {
        amountMinor: ReasonCode.ObsoleteField,
        status: ReasonCode.ForbiddenTransition,
      },
    );
  });

  it('retries updates that arrive before the order exists', async () => {
    const decision = createDecision();
    const service = createService(
      decision.service,
      createDecisionWriter().service,
      createFieldVersions(() => Promise.resolve(true)).service,
    );
    const context = createContext({
      manager: createManager(createUpdateMock()),
      order: null,
      payload: {
        currency: 'USD',
      },
    });

    await service.updateOrderFields(context);

    expect(decision.retryOrReject).toHaveBeenCalledWith(
      context,
      ReasonCode.OrderNotReady,
      'Event requires an existing order',
    );
  });
});

function createService(
  decision: OrderApplicationDecisionService,
  decisionWriter: EventDecisionWriterService,
  fieldVersions: OrderFieldVersionService,
): OrderUpdateApplicationService {
  return new OrderUpdateApplicationService(
    decision,
    decisionWriter,
    fieldVersions,
    new OrderPayloadReaderService(new EventMoneyService()),
  );
}

interface DecisionMocks {
  service: OrderApplicationDecisionService;
  reject: jest.Mock<
    ReturnType<OrderApplicationDecisionService['reject']>,
    Parameters<OrderApplicationDecisionService['reject']>
  >;
  retryOrReject: jest.Mock<
    ReturnType<OrderApplicationDecisionService['retryOrReject']>,
    Parameters<OrderApplicationDecisionService['retryOrReject']>
  >;
}

function createDecision(): DecisionMocks {
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

  return {
    service: Object.assign(
      Object.create(OrderApplicationDecisionService.prototype),
      {
        reject,
        retryOrReject,
      },
    ) as OrderApplicationDecisionService,
    reject,
    retryOrReject,
  };
}

interface DecisionWriterMocks {
  service: EventDecisionWriterService;
  writeFinalDecision: jest.Mock<
    ReturnType<EventDecisionWriterService['writeFinalDecision']>,
    Parameters<EventDecisionWriterService['writeFinalDecision']>
  >;
}

function createDecisionWriter(): DecisionWriterMocks {
  const writeFinalDecision = jest
    .fn<
      ReturnType<EventDecisionWriterService['writeFinalDecision']>,
      Parameters<EventDecisionWriterService['writeFinalDecision']>
    >()
    .mockResolvedValue(undefined);

  return {
    service: Object.assign(
      Object.create(EventDecisionWriterService.prototype),
      {
        writeFinalDecision,
      },
    ) as EventDecisionWriterService,
    writeFinalDecision,
  };
}

interface FieldVersionMocks {
  service: OrderFieldVersionService;
  canApplyField: jest.Mock<
    ReturnType<OrderFieldVersionService['canApplyField']>,
    Parameters<OrderFieldVersionService['canApplyField']>
  >;
  upsertFieldVersion: jest.Mock<
    ReturnType<OrderFieldVersionService['upsertFieldVersion']>,
    Parameters<OrderFieldVersionService['upsertFieldVersion']>
  >;
}

function createFieldVersions(
  canApplyFieldByName: (fieldName: OrderVersionedField) => Promise<boolean>,
): FieldVersionMocks {
  const canApplyField = jest.fn<
    ReturnType<OrderFieldVersionService['canApplyField']>,
    Parameters<OrderFieldVersionService['canApplyField']>
  >((_manager, _orderId, fieldName) => canApplyFieldByName(fieldName));
  const upsertFieldVersion = jest
    .fn<
      ReturnType<OrderFieldVersionService['upsertFieldVersion']>,
      Parameters<OrderFieldVersionService['upsertFieldVersion']>
    >()
    .mockResolvedValue(undefined);

  return {
    service: Object.assign(Object.create(OrderFieldVersionService.prototype), {
      canApplyField,
      upsertFieldVersion,
    }) as OrderFieldVersionService,
    canApplyField,
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
  payload,
  order = createOrder(),
}: {
  manager: EntityManager;
  payload: JsonObject;
  order?: OrderEntity | null;
}): OrderEventHandlingContext {
  return {
    manager,
    order,
    event: {
      eventId: 'evt-update-1',
      orderId: 'ord-1',
      type: SupportedEventType.OrderUpdated,
      timestamp: 1710001000,
      payload,
    },
    delivery: Object.assign(new RawIncomingEventEntity(), {
      id: 20,
      attempts: 0,
    }),
    getProcessingTimeMs: jest.fn().mockResolvedValue(8),
  };
}

function createOrder(): OrderEntity {
  return Object.assign(new OrderEntity(), {
    orderId: 'ord-1',
    status: OrderStatus.Paid,
    amountMinor: 4255,
    currency: 'USD',
    paidAmountMinor: 4255,
    refundedAmountMinor: 0,
    createdAt: '2026-05-25T10:00:00.000Z',
    updatedAt: '2026-05-25T10:00:00.000Z',
  });
}
