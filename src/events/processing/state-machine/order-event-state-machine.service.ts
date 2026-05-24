import { Injectable } from '@nestjs/common';
import { SupportedEventType } from '../../event.types';
import type { ValidOrderEvent } from '../../event.types';
import type {
  OrderEventStateMachineContext,
  OrderEventStateMachineResult,
} from '../event-processing.types';
import { OrderCancelledEventHandler } from './handlers/order-cancelled-event.handler';
import { OrderCreatedEventHandler } from './handlers/order-created-event.handler';
import type { OrderEventHandler } from './handlers/order-event-handler';
import { OrderUpdatedEventHandler } from './handlers/order-updated-event.handler';
import { PaymentCapturedEventHandler } from './handlers/payment-captured-event.handler';
import { RefundIssuedEventHandler } from './handlers/refund-issued-event.handler';

@Injectable()
export class OrderEventStateMachineService {
  private readonly handlers: Record<SupportedEventType, OrderEventHandler>;

  constructor(
    orderCreatedHandler: OrderCreatedEventHandler,
    orderUpdatedHandler: OrderUpdatedEventHandler,
    paymentCapturedHandler: PaymentCapturedEventHandler,
    orderCancelledHandler: OrderCancelledEventHandler,
    refundIssuedHandler: RefundIssuedEventHandler,
  ) {
    this.handlers = {
      [SupportedEventType.OrderCreated]: orderCreatedHandler,
      [SupportedEventType.OrderUpdated]: orderUpdatedHandler,
      [SupportedEventType.PaymentCaptured]: paymentCapturedHandler,
      [SupportedEventType.OrderCancelled]: orderCancelledHandler,
      [SupportedEventType.RefundIssued]: refundIssuedHandler,
    };
  }

  apply(
    event: ValidOrderEvent,
    context: OrderEventStateMachineContext,
  ): OrderEventStateMachineResult {
    return this.handlers[event.type].apply(event, context);
  }
}
