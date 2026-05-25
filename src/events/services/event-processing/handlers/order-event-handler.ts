import { OrderEntity, RawIncomingEventEntity } from 'src/database/entities';

export interface OrderEventHandler {
  handleOrderCreatedEvent(
    order: OrderEntity | null,
    event: RawIncomingEventEntity,
  ): void;
  handleOrderUpdatedEvent(
    order: OrderEntity | null,
    event: RawIncomingEventEntity,
  ): void;
  handlePaymentCapturedEvent(
    order: OrderEntity | null,
    event: RawIncomingEventEntity,
  ): void;
  handleOrderCancelledEvent(
    order: OrderEntity | null,
    event: RawIncomingEventEntity,
  ): void;
  handleRefundIssuedEvent(
    order: OrderEntity | null,
    event: RawIncomingEventEntity,
  ): void;
}
