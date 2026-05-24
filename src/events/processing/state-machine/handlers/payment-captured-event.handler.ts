import { Injectable } from '@nestjs/common';
import { OrderStatus, SupportedEventType } from '../../../event.types';
import type { ValidOrderEvent } from '../../../event.types';
import { EventDecisionService } from '../../event-decision.service';
import {
  OrderEventStateMachineResultKind,
  type OrderEventStateMachineContext,
  type OrderEventStateMachineResult,
} from '../../event-processing.types';
import { EventValidationService } from '../../event-validation.service';
import { OrderStatusTransitionRulesService } from '../order-status-transition-rules.service';
import type { OrderEventHandler } from './order-event-handler';

@Injectable()
export class PaymentCapturedEventHandler implements OrderEventHandler {
  readonly type = SupportedEventType.PaymentCaptured;

  constructor(
    private readonly validationService: EventValidationService,
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
    const paymentAmount =
      Object.prototype.hasOwnProperty.call(event.payload, 'amount') ||
      order.amount_minor === null
        ? this.validationService.positiveMoneyToMinor(event.payload.amount)
        : order.amount_minor;

    if (paymentAmount === null || paymentAmount <= 0) {
      return {
        kind: OrderEventStateMachineResultKind.Rejected,
        decision: this.decisionService.paymentAmountRequired(),
      };
    }

    if (order.paid_amount_minor > 0) {
      return {
        kind: OrderEventStateMachineResultKind.Rejected,
        decision: this.decisionService.paymentAlreadyCaptured(event),
      };
    }

    if (
      !this.statusTransitionRules.canEventChangeStatus(
        event.type,
        order.status,
        OrderStatus.Paid,
      )
    ) {
      return {
        kind: OrderEventStateMachineResultKind.Rejected,
        decision: this.decisionService.forbiddenPayment(event, order),
      };
    }

    const fields = {
      changed: { status: OrderStatus.Paid, paidAmountMinor: paymentAmount },
      skipped: {},
    };
    return {
      kind: OrderEventStateMachineResultKind.Mutation,
      order,
      nextState: {
        status: OrderStatus.Paid,
        amountMinor: order.amount_minor,
        currency: order.currency,
        paidAmountMinor: paymentAmount,
        refundedAmountMinor: order.refunded_amount_minor,
      },
      fields,
      decision: this.decisionService.appliedMutation(event, fields),
    };
  }
}
