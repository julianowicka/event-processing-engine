import { EntityManager } from 'typeorm';
import {
  OrderEntity,
  RawIncomingEventEntity,
} from '../../../../database/entities';
import { ValidOrderEvent } from '../../../types/event.types';

export interface OrderEventHandlingContext {
  manager: EntityManager;
  order: OrderEntity | null;
  event: ValidOrderEvent;
  delivery: RawIncomingEventEntity;
  getProcessingTimeMs: () => Promise<number>;
}

export interface OrderEventHandler {
  handleOrderCreatedEvent(context: OrderEventHandlingContext): Promise<void>;
  handleOrderUpdatedEvent(context: OrderEventHandlingContext): Promise<void>;
  handlePaymentCapturedEvent(context: OrderEventHandlingContext): Promise<void>;
  handleOrderCancelledEvent(context: OrderEventHandlingContext): Promise<void>;
  handleRefundIssuedEvent(context: OrderEventHandlingContext): Promise<void>;
}
