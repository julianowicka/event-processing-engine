import { Injectable } from '@nestjs/common';
import { RawIncomingEventEntity } from 'src/database/entities';
import { OrderStatus } from 'src/events/types/event.types';
import { OrderEventHandler } from './order-event-handler';
import { HandlesOrderStatus } from './order-status-handler.decorator';

@HandlesOrderStatus(OrderStatus.PartiallyRefunded)
@Injectable()
export class OrderPartiallyRefundedEventHandler implements OrderEventHandler {
  handleOrderCreatedEvent(_event: RawIncomingEventEntity): void {}

  handleOrderUpdatedEvent(_event: RawIncomingEventEntity): void {}

  handlePaymentCapturedEvent(_event: RawIncomingEventEntity): void {}

  handleOrderCancelledEvent(_event: RawIncomingEventEntity): void {}

  handleRefundIssuedEvent(_event: RawIncomingEventEntity): void {}
}
