import { Injectable } from '@nestjs/common';
import { OrderEntity, RawIncomingEventEntity } from 'src/database/entities';
import { OrderStatus } from 'src/events/types/event.types';
import { OrderEventHandler } from './order-event-handler';
import { HandlesOrderStatus } from './order-status-handler.decorator';

@HandlesOrderStatus(OrderStatus.Cancelled)
@Injectable()
export class OrderCancelledEventHandler implements OrderEventHandler {
  handleOrderCreatedEvent(
    _order: OrderEntity | null,
    _event: RawIncomingEventEntity,
  ): void {}

  handleOrderUpdatedEvent(
    _order: OrderEntity | null,
    _event: RawIncomingEventEntity,
  ): void {}

  handlePaymentCapturedEvent(
    _order: OrderEntity | null,
    _event: RawIncomingEventEntity,
  ): void {}

  handleOrderCancelledEvent(
    _order: OrderEntity | null,
    _event: RawIncomingEventEntity,
  ): void {}

  handleRefundIssuedEvent(
    _order: OrderEntity | null,
    _event: RawIncomingEventEntity,
  ): void {}
}
