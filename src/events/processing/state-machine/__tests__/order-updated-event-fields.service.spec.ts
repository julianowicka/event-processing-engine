import type { JsonObject } from '../../../../common/json.types';
import {
  OrderStatus,
  OrderVersionedField,
  ReasonCode,
  SupportedEventType,
} from '../../../event.types';
import type { OrderRow, ValidOrderEvent } from '../../../event.types';
import { EventValidationService } from '../../event-validation.service';
import { OrderStatusTransitionRulesService } from '../order-status-transition-rules.service';
import { OrderUpdatedEventFieldsService } from '../order-updated-event-fields.service';

describe('OrderUpdatedEventFieldsService', () => {
  const validationService = new EventValidationService();
  const statusTransitionRules = new OrderStatusTransitionRulesService();
  const service = new OrderUpdatedEventFieldsService(
    validationService,
    statusTransitionRules,
  );

  it('partially applies late updates when only some fields are still current', () => {
    const result = service.buildChangesFromOrderUpdatedEvent(
      event({
        amount: 120,
        currency: 'EUR',
      }),
      order(),
      (fieldName) => fieldName === OrderVersionedField.Currency,
    );

    expect(result.nextState).toMatchObject({
      status: OrderStatus.Created,
      amountMinor: 10000,
      currency: 'EUR',
      paidAmountMinor: 0,
      refundedAmountMinor: 0,
    });
    expect(result.fields).toEqual({
      changed: { currency: 'EUR' },
      skipped: { amountMinor: ReasonCode.ObsoleteField },
    });
  });

  it('skips status changes that fail the state machine', () => {
    const result = service.buildChangesFromOrderUpdatedEvent(
      event({ status: OrderStatus.Paid }),
      order({ status: OrderStatus.Cancelled }),
      () => true,
    );

    expect(result.nextState.status).toBe(OrderStatus.Cancelled);
    expect(result.fields).toEqual({
      changed: {},
      skipped: { status: ReasonCode.ForbiddenTransition },
    });
  });

  function event(payload: JsonObject): ValidOrderEvent {
    return {
      eventId: 'evt-merge-001',
      orderId: 'ord-merge-001',
      type: SupportedEventType.OrderUpdated,
      timestamp: 1710002000,
      payload,
    };
  }

  function order(overrides: Partial<OrderRow> = {}): OrderRow {
    return {
      order_id: 'ord-merge-001',
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
