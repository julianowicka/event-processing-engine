import type { JsonObject } from '../../../../common/json.types';
import {
  EngineDecision,
  OrderStatus,
  OrderVersionedField,
  ReasonCode,
  SupportedEventType,
} from '../../../event.types';
import type { OrderRow, ValidOrderEvent } from '../../../event.types';
import { OrderEventStateMachineResultKind } from '../../event-processing.types';
import { EventDecisionService } from '../../event-decision.service';
import { EventValidationService } from '../../event-validation.service';
import { OrderCancelledEventHandler } from '../handlers/order-cancelled-event.handler';
import { OrderCreatedEventHandler } from '../handlers/order-created-event.handler';
import { OrderUpdatedEventHandler } from '../handlers/order-updated-event.handler';
import { PaymentCapturedEventHandler } from '../handlers/payment-captured-event.handler';
import { RefundIssuedEventHandler } from '../handlers/refund-issued-event.handler';
import { OrderEventStateMachineService } from '../order-event-state-machine.service';
import { OrderStatusTransitionRulesService } from '../order-status-transition-rules.service';
import { OrderUpdatedEventFieldsService } from '../order-updated-event-fields.service';

describe('OrderEventStateMachineService', () => {
  const validationService = new EventValidationService();
  const statusTransitionRules = new OrderStatusTransitionRulesService();
  const orderUpdatedEventFields = new OrderUpdatedEventFieldsService(
    validationService,
    statusTransitionRules,
  );
  const decisionService = new EventDecisionService();
  const service = new OrderEventStateMachineService(
    new OrderCreatedEventHandler(validationService, decisionService),
    new OrderUpdatedEventHandler(orderUpdatedEventFields, decisionService),
    new PaymentCapturedEventHandler(
      validationService,
      statusTransitionRules,
      decisionService,
    ),
    new OrderCancelledEventHandler(statusTransitionRules, decisionService),
    new RefundIssuedEventHandler(
      validationService,
      statusTransitionRules,
      decisionService,
    ),
  );

  it('routes each supported event type through its handler strategy', () => {
    const created = new OrderCreatedEventHandler(
      validationService,
      decisionService,
    );
    const updated = new OrderUpdatedEventHandler(
      orderUpdatedEventFields,
      decisionService,
    );
    const payment = new PaymentCapturedEventHandler(
      validationService,
      statusTransitionRules,
      decisionService,
    );
    const cancellation = new OrderCancelledEventHandler(
      statusTransitionRules,
      decisionService,
    );
    const refund = new RefundIssuedEventHandler(
      validationService,
      statusTransitionRules,
      decisionService,
    );
    const handlers = [created, updated, payment, cancellation, refund];
    const routed = new OrderEventStateMachineService(
      created,
      updated,
      payment,
      cancellation,
      refund,
    );

    for (const handler of handlers) {
      const applySpy = jest.spyOn(handler, 'apply');
      routed.apply(event(handler.type), {
        order: null,
        canApplyField: () => true,
        hasPendingPaymentForOrder: () => false,
      });
      expect(applySpy).toHaveBeenCalledTimes(1);
    }
  });

  it('creates an order from ORDER_CREATED', () => {
    const result = apply(
      event(SupportedEventType.OrderCreated, { amount: 120, currency: 'PLN' }),
      null,
    );

    expect(result).toMatchObject({
      kind: OrderEventStateMachineResultKind.Created,
      createdOrder: {
        amountMinor: 12000,
        currency: 'PLN',
        changedFields: {
          status: OrderStatus.Created,
          amountMinor: 12000,
          currency: 'PLN',
        },
      },
      decision: {
        decision: EngineDecision.Accepted,
        reasonCode: ReasonCode.Applied,
      },
    });
  });

  it('rejects ORDER_CREATED when the order already exists', () => {
    const result = apply(event(SupportedEventType.OrderCreated), order());

    expect(result).toMatchObject({
      kind: OrderEventStateMachineResultKind.Rejected,
      decision: {
        decision: EngineDecision.Rejected,
        reasonCode: ReasonCode.OrderAlreadyExists,
      },
    });
  });

  it('builds partial merge mutations for ORDER_UPDATED', () => {
    const result = apply(
      event(SupportedEventType.OrderUpdated, { amount: 120, currency: 'EUR' }),
      order(),
      {
        canApplyField: (fieldName) =>
          fieldName === OrderVersionedField.Currency,
      },
    );

    expect(result).toMatchObject({
      kind: OrderEventStateMachineResultKind.Mutation,
      nextState: {
        status: OrderStatus.Created,
        amountMinor: 10000,
        currency: 'EUR',
      },
      fields: {
        changed: { currency: 'EUR' },
        skipped: { amountMinor: ReasonCode.ObsoleteField },
      },
    });
  });

  it('captures payment from CREATED to PAID', () => {
    const result = apply(event(SupportedEventType.PaymentCaptured), order());

    expect(result).toMatchObject({
      kind: OrderEventStateMachineResultKind.Mutation,
      nextState: {
        status: OrderStatus.Paid,
        paidAmountMinor: 10000,
      },
      fields: {
        changed: { status: OrderStatus.Paid, paidAmountMinor: 10000 },
        skipped: {},
      },
    });
  });

  it('rejects repeated payment captures', () => {
    const result = apply(
      event(SupportedEventType.PaymentCaptured, { amount: 100 }),
      order({ status: OrderStatus.Paid, paid_amount_minor: 10000 }),
    );

    expect(result).toMatchObject({
      kind: OrderEventStateMachineResultKind.Rejected,
      decision: {
        decision: EngineDecision.Rejected,
        reasonCode: ReasonCode.PaymentAlreadyCaptured,
      },
    });
  });

  it('rejects payment after cancellation', () => {
    const result = apply(
      event(SupportedEventType.PaymentCaptured, { amount: 100 }),
      order({ status: OrderStatus.Cancelled }),
    );

    expect(result).toMatchObject({
      kind: OrderEventStateMachineResultKind.Rejected,
      decision: {
        decision: EngineDecision.Rejected,
        reasonCode: ReasonCode.ForbiddenTransition,
      },
    });
  });

  it('cancels an order from CREATED', () => {
    const result = apply(event(SupportedEventType.OrderCancelled), order());

    expect(result).toMatchObject({
      kind: OrderEventStateMachineResultKind.Mutation,
      nextState: {
        status: OrderStatus.Cancelled,
      },
      fields: {
        changed: { status: OrderStatus.Cancelled },
        skipped: {},
      },
    });
  });

  it('rejects forbidden cancellation', () => {
    const result = apply(
      event(SupportedEventType.OrderCancelled),
      order({ status: OrderStatus.Paid, paid_amount_minor: 10000 }),
    );

    expect(result).toMatchObject({
      kind: OrderEventStateMachineResultKind.Rejected,
      decision: {
        decision: EngineDecision.Rejected,
        reasonCode: ReasonCode.ForbiddenTransition,
      },
    });
  });

  it('applies a partial refund', () => {
    const result = apply(
      event(SupportedEventType.RefundIssued, { refundAmount: 30 }),
      order({ status: OrderStatus.Paid, paid_amount_minor: 10000 }),
    );

    expect(result).toMatchObject({
      kind: OrderEventStateMachineResultKind.Mutation,
      nextState: {
        status: OrderStatus.PartiallyRefunded,
        refundedAmountMinor: 3000,
      },
      fields: {
        changed: {
          status: OrderStatus.PartiallyRefunded,
          refundedAmountMinor: 3000,
        },
        skipped: {},
      },
    });
  });

  it('applies a full refund', () => {
    const result = apply(
      event(SupportedEventType.RefundIssued, { refundAmount: 70 }),
      order({
        status: OrderStatus.PartiallyRefunded,
        paid_amount_minor: 10000,
        refunded_amount_minor: 3000,
      }),
    );

    expect(result).toMatchObject({
      kind: OrderEventStateMachineResultKind.Mutation,
      nextState: {
        status: OrderStatus.Refunded,
        refundedAmountMinor: 10000,
      },
      fields: {
        changed: {
          status: OrderStatus.Refunded,
          refundedAmountMinor: 10000,
        },
        skipped: {},
      },
    });
  });

  it('rejects refunds above captured payment', () => {
    const result = apply(
      event(SupportedEventType.RefundIssued, { refundAmount: 60 }),
      order({ status: OrderStatus.Paid, paid_amount_minor: 5000 }),
    );

    expect(result).toMatchObject({
      kind: OrderEventStateMachineResultKind.Rejected,
      decision: {
        decision: EngineDecision.Rejected,
        reasonCode: ReasonCode.RefundExceedsCaptured,
      },
    });
  });

  it('defers refunds while a matching payment job is still pending', () => {
    const result = apply(
      event(SupportedEventType.RefundIssued, { refundAmount: 30 }),
      order(),
      {
        hasPendingPaymentForOrder: () => true,
      },
    );

    expect(result).toMatchObject({
      kind: OrderEventStateMachineResultKind.Deferred,
      decision: {
        decision: EngineDecision.Deferred,
        reasonCode: ReasonCode.OrderNotReady,
      },
    });
  });

  function apply(
    eventItem: ValidOrderEvent,
    orderRow: OrderRow | null,
    overrides: {
      canApplyField?: (fieldName: OrderVersionedField) => boolean;
      hasPendingPaymentForOrder?: () => boolean;
    } = {},
  ) {
    return service.apply(eventItem, {
      order: orderRow,
      canApplyField: overrides.canApplyField ?? (() => true),
      hasPendingPaymentForOrder:
        overrides.hasPendingPaymentForOrder ?? (() => false),
    });
  }

  function event(
    type: SupportedEventType,
    payload: JsonObject = {},
  ): ValidOrderEvent {
    return {
      eventId: `evt-${type.toLowerCase()}`,
      orderId: 'ord-application-001',
      type,
      timestamp: 1710002000,
      payload,
    };
  }

  function order(overrides: Partial<OrderRow> = {}): OrderRow {
    return {
      order_id: 'ord-application-001',
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
      ...overrides,
    };
  }
});
