import type { OrderRow, SupportedEventType, ValidOrderEvent } from '../event.types';
import { EventDecisionService } from './event-decision.service';
import { EventValidationService } from './event-validation.service';
import { OrderEventApplicationService } from './order-event-application.service';
import { OrderMergeService } from './order-merge.service';
import { OrderStateMachineService } from './order-state-machine.service';

describe('OrderEventApplicationService', () => {
  const validationService = new EventValidationService();
  const stateMachineService = new OrderStateMachineService();
  const mergeService = new OrderMergeService(
    validationService,
    stateMachineService,
  );
  const service = new OrderEventApplicationService(
    validationService,
    stateMachineService,
    mergeService,
    new EventDecisionService(),
  );

  it('creates an order from ORDER_CREATED', () => {
    const result = apply(
      event('ORDER_CREATED', { amount: 120, currency: 'PLN' }),
      null,
    );

    expect(result).toEqual({
      kind: 'CREATED',
      createdOrder: {
        amountMinor: 12000,
        currency: 'PLN',
        changedFields: {
          status: 'CREATED',
          amountMinor: 12000,
          currency: 'PLN',
        },
      },
    });
  });

  it('rejects ORDER_CREATED when the order already exists', () => {
    const result = apply(event('ORDER_CREATED'), order());

    expect(result).toMatchObject({
      kind: 'REJECTED',
      decision: {
        decision: 'REJECTED',
        reasonCode: 'ORDER_ALREADY_EXISTS',
      },
    });
  });

  it('builds partial merge mutations for ORDER_UPDATED', () => {
    const result = apply(
      event('ORDER_UPDATED', { amount: 120, currency: 'EUR' }),
      order(),
      {
        canApplyField: (fieldName) => fieldName === 'currency',
      },
    );

    expect(result).toMatchObject({
      kind: 'MUTATION',
      nextState: {
        status: 'CREATED',
        amountMinor: 10000,
        currency: 'EUR',
      },
      fields: {
        changed: { currency: 'EUR' },
        skipped: { amountMinor: 'OBSOLETE_FIELD' },
      },
    });
  });

  it('captures payment from CREATED to PAID', () => {
    const result = apply(event('PAYMENT_CAPTURED'), order());

    expect(result).toMatchObject({
      kind: 'MUTATION',
      nextState: {
        status: 'PAID',
        paidAmountMinor: 10000,
      },
      fields: {
        changed: { status: 'PAID', paidAmountMinor: 10000 },
        skipped: {},
      },
    });
  });

  it('rejects repeated payment captures', () => {
    const result = apply(
      event('PAYMENT_CAPTURED', { amount: 100 }),
      order({ status: 'PAID', paid_amount_minor: 10000 }),
    );

    expect(result).toMatchObject({
      kind: 'REJECTED',
      decision: {
        decision: 'REJECTED',
        reasonCode: 'PAYMENT_ALREADY_CAPTURED',
      },
    });
  });

  it('rejects payment after cancellation', () => {
    const result = apply(
      event('PAYMENT_CAPTURED', { amount: 100 }),
      order({ status: 'CANCELLED' }),
    );

    expect(result).toMatchObject({
      kind: 'REJECTED',
      decision: {
        decision: 'REJECTED',
        reasonCode: 'FORBIDDEN_TRANSITION',
      },
    });
  });

  it('cancels an order from CREATED', () => {
    const result = apply(event('ORDER_CANCELLED'), order());

    expect(result).toMatchObject({
      kind: 'MUTATION',
      nextState: {
        status: 'CANCELLED',
      },
      fields: {
        changed: { status: 'CANCELLED' },
        skipped: {},
      },
    });
  });

  it('rejects forbidden cancellation', () => {
    const result = apply(
      event('ORDER_CANCELLED'),
      order({ status: 'PAID', paid_amount_minor: 10000 }),
    );

    expect(result).toMatchObject({
      kind: 'REJECTED',
      decision: {
        decision: 'REJECTED',
        reasonCode: 'FORBIDDEN_TRANSITION',
      },
    });
  });

  it('applies a partial refund', () => {
    const result = apply(
      event('REFUND_ISSUED', { refundAmount: 30 }),
      order({ status: 'PAID', paid_amount_minor: 10000 }),
    );

    expect(result).toMatchObject({
      kind: 'MUTATION',
      nextState: {
        status: 'PARTIALLY_REFUNDED',
        refundedAmountMinor: 3000,
      },
      fields: {
        changed: {
          status: 'PARTIALLY_REFUNDED',
          refundedAmountMinor: 3000,
        },
        skipped: {},
      },
    });
  });

  it('applies a full refund', () => {
    const result = apply(
      event('REFUND_ISSUED', { refundAmount: 70 }),
      order({
        status: 'PARTIALLY_REFUNDED',
        paid_amount_minor: 10000,
        refunded_amount_minor: 3000,
      }),
    );

    expect(result).toMatchObject({
      kind: 'MUTATION',
      nextState: {
        status: 'REFUNDED',
        refundedAmountMinor: 10000,
      },
      fields: {
        changed: {
          status: 'REFUNDED',
          refundedAmountMinor: 10000,
        },
        skipped: {},
      },
    });
  });

  it('rejects refunds above captured payment', () => {
    const result = apply(
      event('REFUND_ISSUED', { refundAmount: 60 }),
      order({ status: 'PAID', paid_amount_minor: 5000 }),
    );

    expect(result).toMatchObject({
      kind: 'REJECTED',
      decision: {
        decision: 'REJECTED',
        reasonCode: 'REFUND_EXCEEDS_CAPTURED',
      },
    });
  });

  it('defers refunds while a matching payment job is still pending', () => {
    const result = apply(
      event('REFUND_ISSUED', { refundAmount: 30 }),
      order(),
      {
        hasPendingPaymentForOrder: () => true,
      },
    );

    expect(result).toMatchObject({
      kind: 'DEFERRED',
      decision: {
        decision: 'DEFERRED',
        reasonCode: 'ORDER_NOT_READY',
      },
    });
  });

  function apply(
    eventItem: ValidOrderEvent,
    orderRow: OrderRow | null,
    overrides: {
      canApplyField?: (fieldName: string) => boolean;
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
    payload: Record<string, unknown> = {},
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
      status: 'CREATED',
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
