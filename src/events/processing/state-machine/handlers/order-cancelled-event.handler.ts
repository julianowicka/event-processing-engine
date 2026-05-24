import { Injectable } from '@nestjs/common';
import { OrderStatus, SupportedEventType } from '../../../event.types';
import type { ValidOrderEvent } from '../../../event.types';
import { EventDecisionService } from '../../event-decision.service';
import {
  OrderEventStateMachineResultKind,
  type OrderEventStateMachineContext,
  type OrderEventStateMachineResult,
} from '../../event-processing.types';
import { OrderStatusTransitionRulesService } from '../order-status-transition-rules.service';
import type { OrderEventHandler } from './order-event-handler';

@Injectable()
export class OrderCancelledEventHandler implements OrderEventHandler {
  readonly type = SupportedEventType.OrderCancelled;

  constructor(
    private readonly statusTransitionRules: OrderStatusTransitionRulesService,
    private readonly decisionService: EventDecisionService,
  ) {}

  apply(
    event: ValidOrderEvent,
    context: OrderEventStateMachineContext,
  ): OrderEventStateMachineResult {
    if (!context.order) {
      return {
        kind: OrderEventStateMachineResultKind.Deferred,
        decision: this.decisionService.orderNotReady(event),
      };
    }

    const order = context.order;

    if (
      !this.statusTransitionRules.canEventChangeStatus(
        event.type,
        order.status,
        OrderStatus.Cancelled,
      )
    ) {
      return {
        kind: OrderEventStateMachineResultKind.Rejected,
        decision: this.decisionService.forbiddenCancellation(event, order),
      };
    }

    const fields = {
      changed: { status: OrderStatus.Cancelled },
      skipped: {},
    };
    return {
      kind: OrderEventStateMachineResultKind.Mutation,
      order,
      nextState: {
        status: OrderStatus.Cancelled,
        amountMinor: order.amount_minor,
        currency: order.currency,
        paidAmountMinor: order.paid_amount_minor,
        refundedAmountMinor: order.refunded_amount_minor,
      },
      fields,
      decision: this.decisionService.appliedMutation(event, fields),
    };
  }
}
