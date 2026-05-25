import { Injectable } from '@nestjs/common';
import { OrderStatus } from '../../../types/event.types';
import { OrderStateApplicationService } from '../order-state-application.service';
import {
  OrderEventHandler,
  type OrderEventHandlingContext,
} from './order-event-handler';
import { HandlesOrderStatus } from './order-status-handler.decorator';

@HandlesOrderStatus(OrderStatus.Paid)
@Injectable()
export class OrderPaidEventHandler implements OrderEventHandler {
  constructor(private readonly orders: OrderStateApplicationService) {}

  async handleOrderCreatedEvent(
    context: OrderEventHandlingContext,
  ): Promise<void> {
    await this.orders.rejectOrderAlreadyExists(context);
  }

  async handleOrderUpdatedEvent(
    context: OrderEventHandlingContext,
  ): Promise<void> {
    await this.orders.updateOrderFields(context);
  }

  async handlePaymentCapturedEvent(
    context: OrderEventHandlingContext,
  ): Promise<void> {
    await this.orders.capturePayment(context);
  }

  async handleOrderCancelledEvent(
    context: OrderEventHandlingContext,
  ): Promise<void> {
    await this.orders.rejectForbiddenTransition(context);
  }

  async handleRefundIssuedEvent(
    context: OrderEventHandlingContext,
  ): Promise<void> {
    await this.orders.issueRefund(context);
  }
}
