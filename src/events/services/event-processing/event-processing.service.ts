import { Injectable } from '@nestjs/common';
import { RawIncomingEventEntity } from 'src/database/entities';
import { OrderRepository } from 'src/events/repositories';
import { OrderStatus, SupportedEventType } from 'src/events/types/event.types';
import { NonExistentOrderEventHandler } from './handlers/non-existent-order-event.handler';
import { OrderEventHandlerFactory } from './handlers/order-event-handler.factory';

@Injectable()
export class EventProcessingService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly orderEventHandlerFactory: OrderEventHandlerFactory,
    private readonly nonExistentOrderEventHandler: NonExistentOrderEventHandler,
  ) {}

  async processEvent(event: RawIncomingEventEntity): Promise<void> {
    if (!event.orderId) {
      // TODO: REJECT EVENT
      return;
    }

    const order = await this.orderRepository.findById(event.orderId);

    const orderEventHandler =
      this.orderEventHandlerFactory.createOrderEventHandler(order?.status ?? OrderStatus.DoesNotExist);

    switch (event.type) {
      case SupportedEventType.OrderCreated:
        orderEventHandler.handleOrderCreatedEvent(event);
        return;
      case SupportedEventType.OrderUpdated:
        orderEventHandler.handleOrderUpdatedEvent(event);
        return;
      case SupportedEventType.PaymentCaptured:
        orderEventHandler.handlePaymentCapturedEvent(event);
        return;
      case SupportedEventType.OrderCancelled:
        orderEventHandler.handleOrderCancelledEvent(event);
        return;
      case SupportedEventType.RefundIssued:
        orderEventHandler.handleRefundIssuedEvent(event);
        return;
      default:
        // TODO: REJECT EVENT
        return;
    }
  }
}
