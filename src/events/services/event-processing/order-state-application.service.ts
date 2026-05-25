import { Injectable } from '@nestjs/common';
import { OrderStatus, ReasonCode } from '../../types/event.types';
import type { OrderEventHandlingContext } from './handlers/order-event-handler';
import { OrderApplicationDecisionService } from './order-application-decision.service';
import { OrderCreationApplicationService } from './order-creation-application.service';
import { OrderLifecycleApplicationService } from './order-lifecycle-application.service';
import { OrderUpdateApplicationService } from './order-update-application.service';

@Injectable()
export class OrderStateApplicationService {
  constructor(
    private readonly creation: OrderCreationApplicationService,
    private readonly decision: OrderApplicationDecisionService,
    private readonly lifecycle: OrderLifecycleApplicationService,
    private readonly updates: OrderUpdateApplicationService,
  ) {}

  async createOrder(context: OrderEventHandlingContext): Promise<void> {
    await this.creation.createOrder(context);
  }

  async updateOrderFields(context: OrderEventHandlingContext): Promise<void> {
    await this.updates.updateOrderFields(context);
  }

  async capturePayment(context: OrderEventHandlingContext): Promise<void> {
    await this.lifecycle.capturePayment(context);
  }

  async cancelOrder(context: OrderEventHandlingContext): Promise<void> {
    await this.lifecycle.cancelOrder(context);
  }

  async issueRefund(context: OrderEventHandlingContext): Promise<void> {
    await this.lifecycle.issueRefund(context);
  }

  async rejectOrderAlreadyExists(
    context: OrderEventHandlingContext,
  ): Promise<void> {
    await this.decision.reject(
      context,
      ReasonCode.OrderAlreadyExists,
      'ORDER_CREATED cannot be applied because the order already exists',
    );
  }

  async rejectOrderNotReady(context: OrderEventHandlingContext): Promise<void> {
    await this.decision.reject(
      context,
      ReasonCode.OrderNotReady,
      'Event requires an existing order',
    );
  }

  async rejectForbiddenTransition(
    context: OrderEventHandlingContext,
  ): Promise<void> {
    await this.decision.reject(
      context,
      ReasonCode.ForbiddenTransition,
      `Event ${context.event.type} cannot be applied while order status is ${context.order?.status ?? OrderStatus.DoesNotExist}`,
    );
  }
}
