import { RawIncomingEventEntity } from 'src/database/entities';

export interface OrderEventHandler {
  handleOrderCreatedEvent(event: RawIncomingEventEntity): void;
  handleOrderUpdatedEvent(event: RawIncomingEventEntity): void;
  handlePaymentCapturedEvent(event: RawIncomingEventEntity): void;
  handleOrderCancelledEvent(event: RawIncomingEventEntity): void;
  handleRefundIssuedEvent(event: RawIncomingEventEntity): void;
}
