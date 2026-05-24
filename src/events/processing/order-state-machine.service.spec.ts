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
});
