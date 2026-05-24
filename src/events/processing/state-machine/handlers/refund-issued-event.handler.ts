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
export class RefundIssuedEventHandler implements OrderEventHandler {
  readonly type = SupportedEventType.RefundIssued;

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
    const amountValue = Object.prototype.hasOwnProperty.call(
      event.payload,
      'refundAmount',
    )
      ? event.payload.refundAmount
      : event.payload.amount;
    const refundAmount =
      this.validationService.positiveMoneyToMinor(amountValue);

    if (refundAmount === null || refundAmount <= 0) {
      return {
        kind: OrderEventStateMachineResultKind.Rejected,
        decision: this.decisionService.refundAmountRequired(),
      };
    }

    if (
      order.status === OrderStatus.Created &&
      context.hasPendingPaymentForOrder()
    ) {
      return {
        kind: OrderEventStateMachineResultKind.Deferred,
        decision: this.decisionService.orderNotReady(event),
      };
    }

    if (
      order.status !== OrderStatus.Paid &&
      order.status !== OrderStatus.PartiallyRefunded
    ) {
      return {
        kind: OrderEventStateMachineResultKind.Rejected,
        decision: this.decisionService.forbiddenRefund(event, order),
      };
    }

    const nextRefundedAmount = order.refunded_amount_minor + refundAmount;

    if (nextRefundedAmount > order.paid_amount_minor) {
      return {
        kind: OrderEventStateMachineResultKind.Rejected,
        decision: this.decisionService.refundExceedsCaptured(event),
      };
    }

    const nextStatus: OrderStatus =
      nextRefundedAmount === order.paid_amount_minor
        ? OrderStatus.Refunded
        : OrderStatus.PartiallyRefunded;

    if (
      !this.statusTransitionRules.canEventChangeStatus(
        event.type,
        order.status,
        nextStatus,
      )
    ) {
      return {
        kind: OrderEventStateMachineResultKind.Rejected,
        decision: this.decisionService.forbiddenRefund(event, order),
      };
    }

    const fields = {
      changed: {
        status: nextStatus,
        refundedAmountMinor: nextRefundedAmount,
      },
      skipped: {},
    };
    return {
      kind: OrderEventStateMachineResultKind.Mutation,
      order,
      nextState: {
        status: nextStatus,
        amountMinor: order.amount_minor,
        currency: order.currency,
        paidAmountMinor: order.paid_amount_minor,
        refundedAmountMinor: nextRefundedAmount,
      },
      fields,
      decision: this.decisionService.appliedMutation(event, fields),
    };
  }
}
