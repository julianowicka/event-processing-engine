import type { OrderRow, ValidOrderEvent } from '../event.types';
import { EventValidationService } from './event-validation.service';
import { OrderMergeService } from './order-merge.service';
import { OrderStateMachineService } from './order-state-machine.service';

describe('OrderMergeService', () => {
  const validationService = new EventValidationService();
  const stateMachineService = new OrderStateMachineService();
  const service = new OrderMergeService(validationService, stateMachineService);

  it('partially applies late updates when only some fields are still current', () => {
    const result = service.buildOrderUpdatedMutation(
      event({
        amount: 120,
        currency: 'EUR',
      }),
      order(),
      (fieldName) => fieldName === 'currency',
    );

    expect(result.nextState).toMatchObject({
      status: 'CREATED',
      amountMinor: 10000,
      currency: 'EUR',
      paidAmountMinor: 0,
      refundedAmountMinor: 0,
    });
    expect(result.fields).toEqual({
      changed: { currency: 'EUR' },
      skipped: { amountMinor: 'OBSOLETE_FIELD' },
    });
  });

  it('skips status changes that fail the state machine', () => {
    const result = service.buildOrderUpdatedMutation(
      event({ status: 'PAID' }),
      order({ status: 'CANCELLED' }),
      () => true,
    );

    expect(result.nextState.status).toBe('CANCELLED');
    expect(result.fields).toEqual({
      changed: {},
      skipped: { status: 'FORBIDDEN_TRANSITION' },
    });
  });

  function event(payload: Record<string, unknown>): ValidOrderEvent {
    return {
      eventId: 'evt-merge-001',
      orderId: 'ord-merge-001',
      type: 'ORDER_UPDATED',
      timestamp: 1710002000,
      payload,
    };
  }

  function order(overrides: Partial<OrderRow> = {}): OrderRow {
    return {
      order_id: 'ord-merge-001',
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
