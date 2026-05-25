import { Injectable } from '@nestjs/common';
import { OrderStatus } from '../../../types/event.types';
import { OrderStateApplicationService } from '../order-state-application.service';
import {
  OrderEventHandler,
  type OrderEventHandlingContext,
} from './order-event-handler';
import { HandlesOrderStatus } from './order-status-handler.decorator';

@Injectable()
@HandlesOrderStatus(OrderStatus.DoesNotExist)
export class NonExistentOrderEventHandler implements OrderEventHandler {
  constructor(private readonly orders: OrderStateApplicationService) {}

  async handleOrderCreatedEvent(
    context: OrderEventHandlingContext,
  ): Promise<void> {
    await this.orders.createOrder(context);
  }

  async handleOrderUpdatedEvent(
    context: OrderEventHandlingContext,
  ): Promise<void> {
    await this.orders.rejectOrderNotReady(context);
  }

  async handlePaymentCapturedEvent(
    context: OrderEventHandlingContext,
  ): Promise<void> {
    await this.orders.rejectOrderNotReady(context);
  }

  async handleOrderCancelledEvent(
    context: OrderEventHandlingContext,
  ): Promise<void> {
    await this.orders.rejectOrderNotReady(context);
  }

  async handleRefundIssuedEvent(
    context: OrderEventHandlingContext,
  ): Promise<void> {
    await this.orders.rejectOrderNotReady(context);
  }
}
