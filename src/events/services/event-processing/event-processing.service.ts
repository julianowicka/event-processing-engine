import { Injectable } from '@nestjs/common';
import { RawIncomingEventEntity } from 'src/database/entities';
import { OrderRepository } from 'src/events/repositories';
import { OrderStatus, SupportedEventType } from 'src/events/types/event.types';
import { OrderEventHandlerFactory } from './handlers/order-event-handler.factory';

@Injectable()
export class EventProcessingService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly orderEventHandlerFactory: OrderEventHandlerFactory,
  ) {}

  async processEvent(event: RawIncomingEventEntity): Promise<void> {
    if (!event.orderId) {
      // TODO: REJECT EVENT
      return;
    }

    const order = await this.orderRepository.findById(event.orderId);
    const orderStatus = order?.status ?? OrderStatus.DoesNotExist

    const orderEventHandler = this.orderEventHandlerFactory.createOrderEventHandler(orderStatus);

    switch (event.type) {
      case SupportedEventType.OrderCreated:
        orderEventHandler.handleOrderCreatedEvent(order, event);
        return;
      case SupportedEventType.OrderUpdated:
        orderEventHandler.handleOrderUpdatedEvent(order, event);
        return;
      case SupportedEventType.PaymentCaptured:
        orderEventHandler.handlePaymentCapturedEvent(order, event);
        return;
      case SupportedEventType.OrderCancelled:
        orderEventHandler.handleOrderCancelledEvent(order, event);
        return;
      case SupportedEventType.RefundIssued:
        orderEventHandler.handleRefundIssuedEvent(order, event);
        return;
      default:
        // TODO: REJECT EVENT
        return;
    }
  }
}
