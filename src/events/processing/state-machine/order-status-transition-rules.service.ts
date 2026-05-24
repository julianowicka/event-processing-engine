import { Injectable } from '@nestjs/common';
import type { OrderStatus, SupportedEventType } from '../../event.types';

type ConceptualOrderStatus = 'NEW' | OrderStatus;
type EventTransition = {
  from: ConceptualOrderStatus;
  to: OrderStatus;
};

@Injectable()
export class OrderStatusTransitionRulesService {
  private readonly allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
    CREATED: ['PAID', 'CANCELLED'],
    PAID: ['PARTIALLY_REFUNDED', 'REFUNDED'],
    CANCELLED: [],
    PARTIALLY_REFUNDED: ['REFUNDED'],
    REFUNDED: [],
  };

  private readonly eventTransitions: Partial<
    Record<SupportedEventType, EventTransition[]>
  > = {
    ORDER_CREATED: [{ from: 'NEW', to: 'CREATED' }],
    ORDER_UPDATED: [
      { from: 'CREATED', to: 'PAID' },
      { from: 'CREATED', to: 'CANCELLED' },
      { from: 'PAID', to: 'REFUNDED' },
      { from: 'PARTIALLY_REFUNDED', to: 'REFUNDED' },
    ],
    PAYMENT_CAPTURED: [{ from: 'CREATED', to: 'PAID' }],
    ORDER_CANCELLED: [{ from: 'CREATED', to: 'CANCELLED' }],
    REFUND_ISSUED: [
      { from: 'PAID', to: 'PARTIALLY_REFUNDED' },
      { from: 'PAID', to: 'REFUNDED' },
      { from: 'PARTIALLY_REFUNDED', to: 'REFUNDED' },
    ],
  };

  canChangeStatus(from: OrderStatus, to: OrderStatus): boolean {
    if (from === to) {
      return true;
    }

    return this.allowedTransitions[from].includes(to);
  }

  canEventChangeStatus(
    eventType: SupportedEventType,
    from: ConceptualOrderStatus,
    to: OrderStatus,
  ): boolean {
    if (from === to) {
      return true;
    }

    return (
      this.eventTransitions[eventType]?.some(
        (transition) => transition.from === from && transition.to === to,
      ) ?? false
    );
  }

  getAllowedStatusChanges(from: OrderStatus): OrderStatus[] {
    return [...this.allowedTransitions[from]];
  }
}
