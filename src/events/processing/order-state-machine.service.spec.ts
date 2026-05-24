import { OrderStateMachineService } from './order-state-machine.service';

describe('OrderStateMachineService', () => {
  const service = new OrderStateMachineService();

  it('allows expected payment, cancellation and refund transitions', () => {
    expect(service.canTransition('CREATED', 'PAID')).toBe(true);
    expect(service.canTransition('CREATED', 'CANCELLED')).toBe(true);
    expect(service.canTransition('PAID', 'PARTIALLY_REFUNDED')).toBe(true);
    expect(service.canTransition('PAID', 'REFUNDED')).toBe(true);
    expect(service.canTransition('PARTIALLY_REFUNDED', 'REFUNDED')).toBe(true);
  });

  it('rejects forbidden terminal-state transitions', () => {
    expect(service.canTransition('CANCELLED', 'PAID')).toBe(false);
    expect(service.canTransition('REFUNDED', 'PAID')).toBe(false);
    expect(service.canTransition('CANCELLED', 'REFUNDED')).toBe(false);
  });

  it('exposes allowed transitions without leaking internal arrays', () => {
    const allowed = service.getAllowedTransitions('CREATED');

    expect(allowed).toEqual(['PAID', 'CANCELLED']);

    allowed.push('REFUNDED');

    expect(service.getAllowedTransitions('CREATED')).toEqual([
      'PAID',
      'CANCELLED',
    ]);
  });

  it('maps events to their allowed status transitions', () => {
    expect(
      service.canApplyEventTransition('ORDER_CREATED', 'NEW', 'CREATED'),
    ).toBe(true);
    expect(
      service.canApplyEventTransition('PAYMENT_CAPTURED', 'CREATED', 'PAID'),
    ).toBe(true);
    expect(
      service.canApplyEventTransition(
        'ORDER_CANCELLED',
        'CREATED',
        'CANCELLED',
      ),
    ).toBe(true);
    expect(
      service.canApplyEventTransition(
        'REFUND_ISSUED',
        'PAID',
        'PARTIALLY_REFUNDED',
      ),
    ).toBe(true);
    expect(
      service.canApplyEventTransition(
        'REFUND_ISSUED',
        'PARTIALLY_REFUNDED',
        'REFUNDED',
      ),
    ).toBe(true);
  });

  it('rejects event-specific forbidden transitions from the docs', () => {
    expect(
      service.canApplyEventTransition('PAYMENT_CAPTURED', 'CANCELLED', 'PAID'),
    ).toBe(false);
    expect(
      service.canApplyEventTransition('PAYMENT_CAPTURED', 'REFUNDED', 'PAID'),
    ).toBe(false);
    expect(
      service.canApplyEventTransition(
        'REFUND_ISSUED',
        'CANCELLED',
        'REFUNDED',
      ),
    ).toBe(false);
    expect(
      service.canApplyEventTransition(
        'ORDER_UPDATED',
        'PAID',
        'PARTIALLY_REFUNDED',
      ),
    ).toBe(false);
  });
});
