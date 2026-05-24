import { OrderStatusTransitionRulesService } from '../order-status-transition-rules.service';

describe('OrderStatusTransitionRulesService', () => {
  const service = new OrderStatusTransitionRulesService();

  it('allows expected payment, cancellation and refund transitions', () => {
    expect(service.canChangeStatus('CREATED', 'PAID')).toBe(true);
    expect(service.canChangeStatus('CREATED', 'CANCELLED')).toBe(true);
    expect(service.canChangeStatus('PAID', 'PARTIALLY_REFUNDED')).toBe(true);
    expect(service.canChangeStatus('PAID', 'REFUNDED')).toBe(true);
    expect(service.canChangeStatus('PARTIALLY_REFUNDED', 'REFUNDED')).toBe(
      true,
    );
  });

  it('rejects forbidden terminal-state transitions', () => {
    expect(service.canChangeStatus('CANCELLED', 'PAID')).toBe(false);
    expect(service.canChangeStatus('REFUNDED', 'PAID')).toBe(false);
    expect(service.canChangeStatus('CANCELLED', 'REFUNDED')).toBe(false);
  });

  it('exposes allowed transitions without leaking internal arrays', () => {
    const allowed = service.getAllowedStatusChanges('CREATED');

    expect(allowed).toEqual(['PAID', 'CANCELLED']);

    allowed.push('REFUNDED');

    expect(service.getAllowedStatusChanges('CREATED')).toEqual([
      'PAID',
      'CANCELLED',
    ]);
  });

  it('maps events to their allowed status transitions', () => {
    expect(
      service.canEventChangeStatus('ORDER_CREATED', 'NEW', 'CREATED'),
    ).toBe(true);
    expect(
      service.canEventChangeStatus('PAYMENT_CAPTURED', 'CREATED', 'PAID'),
    ).toBe(true);
    expect(
      service.canEventChangeStatus('ORDER_CANCELLED', 'CREATED', 'CANCELLED'),
    ).toBe(true);
    expect(
      service.canEventChangeStatus(
        'REFUND_ISSUED',
        'PAID',
        'PARTIALLY_REFUNDED',
      ),
    ).toBe(true);
    expect(
      service.canEventChangeStatus(
        'REFUND_ISSUED',
        'PARTIALLY_REFUNDED',
        'REFUNDED',
      ),
    ).toBe(true);
  });

  it('rejects event-specific forbidden transitions from the docs', () => {
    expect(
      service.canEventChangeStatus('PAYMENT_CAPTURED', 'CANCELLED', 'PAID'),
    ).toBe(false);
    expect(
      service.canEventChangeStatus('PAYMENT_CAPTURED', 'REFUNDED', 'PAID'),
    ).toBe(false);
    expect(
      service.canEventChangeStatus('REFUND_ISSUED', 'CANCELLED', 'REFUNDED'),
    ).toBe(false);
    expect(
      service.canEventChangeStatus(
        'ORDER_UPDATED',
        'PAID',
        'PARTIALLY_REFUNDED',
      ),
    ).toBe(false);
  });
});
