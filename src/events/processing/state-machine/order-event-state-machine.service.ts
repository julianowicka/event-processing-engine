import { Injectable } from '@nestjs/common';
import type { OrderRow, OrderStatus, ValidOrderEvent } from '../../event.types';
import { EventDecisionService } from '../event-decision.service';
import type {
  FieldChangeSet,
  NextOrderState,
  OrderEventStateMachineContext,
  OrderEventStateMachineResult,
} from '../event-processing.types';
import { EventValidationService } from '../event-validation.service';
import { OrderStatusTransitionRulesService } from './order-status-transition-rules.service';
import { OrderUpdatedEventFieldsService } from './order-updated-event-fields.service';

@Injectable()
export class OrderEventStateMachineService {
  constructor(
    private readonly validationService: EventValidationService,
    private readonly statusTransitionRules: OrderStatusTransitionRulesService,
    private readonly orderUpdatedEventFields: OrderUpdatedEventFieldsService,
    private readonly decisionService: EventDecisionService,
  ) {}

  apply(
    event: ValidOrderEvent,
    context: OrderEventStateMachineContext,
  ): OrderEventStateMachineResult {
    switch (event.type) {
      case 'ORDER_CREATED':
        return this.applyOrderCreated(event, context.order);
      case 'ORDER_UPDATED':
        return this.applyOrderUpdated(event, context);
      case 'PAYMENT_CAPTURED':
        return this.applyPaymentCaptured(event, context);
      case 'ORDER_CANCELLED':
        return this.applyOrderCancelled(event, context);
      case 'REFUND_ISSUED':
        return this.applyRefundIssued(event, context);
    }
  }

  private applyOrderCreated(
    event: ValidOrderEvent,
    existingOrder: OrderRow | null,
  ): OrderEventStateMachineResult {
    if (existingOrder) {
      return {
        kind: 'REJECTED',
        decision: this.decisionService.orderAlreadyExists(event),
      };
    }

    const amountMinor = this.validationService.optionalMoneyToMinor(
      event.payload.amount,
    );
    const currency = this.validationService.optionalCurrency(
      event.payload.currency,
    );
    const changedFields = {
      status: 'CREATED',
      ...(amountMinor === null ? {} : { amountMinor }),
      ...(currency === null ? {} : { currency }),
    };

    return {
      kind: 'CREATED',
      createdOrder: {
        amountMinor,
        currency,
        changedFields,
      },
    };
  }

  private applyOrderUpdated(
    event: ValidOrderEvent,
    context: OrderEventStateMachineContext,
  ): OrderEventStateMachineResult {
    if (!context.order) {
      return this.orderNotReady(event);
    }

    const mutation =
      this.orderUpdatedEventFields.buildChangesFromOrderUpdatedEvent(
        event,
        context.order,
        (fieldName) => context.canApplyField(fieldName),
      );

    return {
      kind: 'MUTATION',
      order: context.order,
      nextState: mutation.nextState,
      fields: mutation.fields,
    };
  }

  private applyPaymentCaptured(
    event: ValidOrderEvent,
    context: OrderEventStateMachineContext,
  ): OrderEventStateMachineResult {
    if (!context.order) {
      return this.orderNotReady(event);
    }

    const order = context.order;
    const paymentAmount =
      Object.prototype.hasOwnProperty.call(event.payload, 'amount') ||
      order.amount_minor === null
        ? this.validationService.positiveMoneyToMinor(event.payload.amount)
        : order.amount_minor;

    if (paymentAmount === null || paymentAmount <= 0) {
      return {
        kind: 'REJECTED',
        decision: this.decisionService.paymentAmountRequired(),
      };
    }

    if (order.paid_amount_minor > 0) {
      return {
        kind: 'REJECTED',
        decision: this.decisionService.paymentAlreadyCaptured(event),
      };
    }

    if (
      !this.statusTransitionRules.canEventChangeStatus(
        event.type,
        order.status,
        'PAID',
      )
    ) {
      return {
        kind: 'REJECTED',
        decision: this.decisionService.forbiddenPayment(event, order),
      };
    }

    return this.mutationResult(
      order,
      {
        status: 'PAID',
        amountMinor: order.amount_minor,
        currency: order.currency,
        paidAmountMinor: paymentAmount,
        refundedAmountMinor: order.refunded_amount_minor,
      },
      {
        changed: { status: 'PAID', paidAmountMinor: paymentAmount },
        skipped: {},
      },
    );
  }

  private applyOrderCancelled(
    event: ValidOrderEvent,
    context: OrderEventStateMachineContext,
  ): OrderEventStateMachineResult {
    if (!context.order) {
      return this.orderNotReady(event);
    }

    const order = context.order;

    if (
      !this.statusTransitionRules.canEventChangeStatus(
        event.type,
        order.status,
        'CANCELLED',
      )
    ) {
      return {
        kind: 'REJECTED',
        decision: this.decisionService.forbiddenCancellation(event, order),
      };
    }

    return this.mutationResult(
      order,
      {
        status: 'CANCELLED',
        amountMinor: order.amount_minor,
        currency: order.currency,
        paidAmountMinor: order.paid_amount_minor,
        refundedAmountMinor: order.refunded_amount_minor,
      },
      {
        changed: { status: 'CANCELLED' },
        skipped: {},
      },
    );
  }

  private applyRefundIssued(
    event: ValidOrderEvent,
    context: OrderEventStateMachineContext,
  ): OrderEventStateMachineResult {
    if (!context.order) {
      return this.orderNotReady(event);
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
        kind: 'REJECTED',
        decision: this.decisionService.refundAmountRequired(),
      };
    }

    if (order.status === 'CREATED' && context.hasPendingPaymentForOrder()) {
      return this.orderNotReady(event);
    }

    if (order.status !== 'PAID' && order.status !== 'PARTIALLY_REFUNDED') {
      return {
        kind: 'REJECTED',
        decision: this.decisionService.forbiddenRefund(event, order),
      };
    }

    const nextRefundedAmount = order.refunded_amount_minor + refundAmount;

    if (nextRefundedAmount > order.paid_amount_minor) {
      return {
        kind: 'REJECTED',
        decision: this.decisionService.refundExceedsCaptured(event),
      };
    }

    const nextStatus: OrderStatus =
      nextRefundedAmount === order.paid_amount_minor
        ? 'REFUNDED'
        : 'PARTIALLY_REFUNDED';

    if (
      !this.statusTransitionRules.canEventChangeStatus(
        event.type,
        order.status,
        nextStatus,
      )
    ) {
      return {
        kind: 'REJECTED',
        decision: this.decisionService.forbiddenRefund(event, order),
      };
    }

    return this.mutationResult(
      order,
      {
        status: nextStatus,
        amountMinor: order.amount_minor,
        currency: order.currency,
        paidAmountMinor: order.paid_amount_minor,
        refundedAmountMinor: nextRefundedAmount,
      },
      {
        changed: {
          status: nextStatus,
          refundedAmountMinor: nextRefundedAmount,
        },
        skipped: {},
      },
    );
  }

  private mutationResult(
    order: OrderRow,
    nextState: NextOrderState,
    fields: FieldChangeSet,
  ): OrderEventStateMachineResult {
    return {
      kind: 'MUTATION',
      order,
      nextState,
      fields,
    };
  }

  private orderNotReady(event: ValidOrderEvent): OrderEventStateMachineResult {
    return {
      kind: 'DEFERRED',
      decision: this.decisionService.orderNotReady(event),
    };
  }
}
