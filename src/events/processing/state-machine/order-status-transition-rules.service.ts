import { Injectable } from '@nestjs/common';
import { OrderStatus, SupportedEventType } from '../../event.types';

export enum ConceptualOrderStatus {
  New = 'NEW',
}

type TransitionOrderStatus = ConceptualOrderStatus | OrderStatus;
type EventTransition = {
  from: TransitionOrderStatus;
  to: OrderStatus;
};

@Injectable()
export class OrderStatusTransitionRulesService {
  private readonly allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
    [OrderStatus.Created]: [OrderStatus.Paid, OrderStatus.Cancelled],
    [OrderStatus.Paid]: [OrderStatus.PartiallyRefunded, OrderStatus.Refunded],
    [OrderStatus.Cancelled]: [],
    [OrderStatus.PartiallyRefunded]: [OrderStatus.Refunded],
    [OrderStatus.Refunded]: [],
  };

  private readonly eventTransitions: Partial<
    Record<SupportedEventType, EventTransition[]>
  > = {
    [SupportedEventType.OrderCreated]: [
      { from: ConceptualOrderStatus.New, to: OrderStatus.Created },
    ],
    [SupportedEventType.OrderUpdated]: [
      { from: OrderStatus.Created, to: OrderStatus.Paid },
      { from: OrderStatus.Created, to: OrderStatus.Cancelled },
      { from: OrderStatus.Paid, to: OrderStatus.Refunded },
      {
        from: OrderStatus.PartiallyRefunded,
        to: OrderStatus.Refunded,
      },
    ],
    [SupportedEventType.PaymentCaptured]: [
      { from: OrderStatus.Created, to: OrderStatus.Paid },
    ],
    [SupportedEventType.OrderCancelled]: [
      { from: OrderStatus.Created, to: OrderStatus.Cancelled },
    ],
    [SupportedEventType.RefundIssued]: [
      { from: OrderStatus.Paid, to: OrderStatus.PartiallyRefunded },
      { from: OrderStatus.Paid, to: OrderStatus.Refunded },
      {
        from: OrderStatus.PartiallyRefunded,
        to: OrderStatus.Refunded,
      },
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
    from: TransitionOrderStatus,
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
