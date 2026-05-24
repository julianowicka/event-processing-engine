import { OrderStatus, SupportedEventType } from '../../../event.types';
import {
  ConceptualOrderStatus,
  OrderStatusTransitionRulesService,
} from '../order-status-transition-rules.service';

describe('OrderStatusTransitionRulesService', () => {
  const service = new OrderStatusTransitionRulesService();

  it('allows expected payment, cancellation and refund transitions', () => {
    expect(service.canChangeStatus(OrderStatus.Created, OrderStatus.Paid)).toBe(
      true,
    );
    expect(
      service.canChangeStatus(OrderStatus.Created, OrderStatus.Cancelled),
    ).toBe(true);
    expect(
      service.canChangeStatus(OrderStatus.Paid, OrderStatus.PartiallyRefunded),
    ).toBe(true);
    expect(
      service.canChangeStatus(OrderStatus.Paid, OrderStatus.Refunded),
    ).toBe(true);
    expect(
      service.canChangeStatus(
        OrderStatus.PartiallyRefunded,
        OrderStatus.Refunded,
      ),
    ).toBe(true);
  });

  it('rejects forbidden terminal-state transitions', () => {
    expect(
      service.canChangeStatus(OrderStatus.Cancelled, OrderStatus.Paid),
    ).toBe(false);
    expect(
      service.canChangeStatus(OrderStatus.Refunded, OrderStatus.Paid),
    ).toBe(false);
    expect(
      service.canChangeStatus(OrderStatus.Cancelled, OrderStatus.Refunded),
    ).toBe(false);
  });

  it('exposes allowed transitions without leaking internal arrays', () => {
    const allowed = service.getAllowedStatusChanges(OrderStatus.Created);

    expect(allowed).toEqual([OrderStatus.Paid, OrderStatus.Cancelled]);

    allowed.push(OrderStatus.Refunded);

    expect(service.getAllowedStatusChanges(OrderStatus.Created)).toEqual([
      OrderStatus.Paid,
      OrderStatus.Cancelled,
    ]);
  });

  it('maps events to their allowed status transitions', () => {
    expect(
      service.canEventChangeStatus(
        SupportedEventType.OrderCreated,
        ConceptualOrderStatus.New,
        OrderStatus.Created,
      ),
    ).toBe(true);
    expect(
      service.canEventChangeStatus(
        SupportedEventType.PaymentCaptured,
        OrderStatus.Created,
        OrderStatus.Paid,
      ),
    ).toBe(true);
    expect(
      service.canEventChangeStatus(
        SupportedEventType.OrderCancelled,
        OrderStatus.Created,
        OrderStatus.Cancelled,
      ),
    ).toBe(true);
    expect(
      service.canEventChangeStatus(
        SupportedEventType.RefundIssued,
        OrderStatus.Paid,
        OrderStatus.PartiallyRefunded,
      ),
    ).toBe(true);
    expect(
      service.canEventChangeStatus(
        SupportedEventType.RefundIssued,
        OrderStatus.PartiallyRefunded,
        OrderStatus.Refunded,
      ),
    ).toBe(true);
  });

  it('rejects event-specific forbidden transitions from the docs', () => {
    expect(
      service.canEventChangeStatus(
        SupportedEventType.PaymentCaptured,
        OrderStatus.Cancelled,
        OrderStatus.Paid,
      ),
    ).toBe(false);
    expect(
      service.canEventChangeStatus(
        SupportedEventType.PaymentCaptured,
        OrderStatus.Refunded,
        OrderStatus.Paid,
      ),
    ).toBe(false);
    expect(
      service.canEventChangeStatus(
        SupportedEventType.RefundIssued,
        OrderStatus.Cancelled,
        OrderStatus.Refunded,
      ),
    ).toBe(false);
    expect(
      service.canEventChangeStatus(
        SupportedEventType.OrderUpdated,
        OrderStatus.Paid,
        OrderStatus.PartiallyRefunded,
      ),
    ).toBe(false);
  });
});
