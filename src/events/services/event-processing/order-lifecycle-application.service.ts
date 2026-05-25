import { Injectable } from '@nestjs/common';
import type { JsonObject } from '../../../common/json.types';
import { OrderEntity } from '../../../database/entities';
import {
  OrderStatus,
  OrderVersionedField,
  ReasonCode,
} from '../../types/event.types';
import { EventMoneyService } from './event-money.service';
import type { OrderEventHandlingContext } from './handlers/order-event-handler';
import { OrderApplicationDecisionService } from './order-application-decision.service';
import { OrderFieldVersionService } from './order-field-version.service';

@Injectable()
export class OrderLifecycleApplicationService {
  constructor(
    private readonly decision: OrderApplicationDecisionService,
    private readonly fieldVersions: OrderFieldVersionService,
    private readonly money: EventMoneyService,
  ) {}

  async capturePayment(context: OrderEventHandlingContext): Promise<void> {
    if (!context.order) {
      await this.rejectOrderNotReady(context);
      return;
    }

    const amountMinor = await this.money.readPositiveAmountMinor(
      context.event.payload,
      'amount',
    );

    if (amountMinor === null) {
      await this.decision.reject(
        context,
        ReasonCode.PaymentAmountRequired,
        'PAYMENT_CAPTURED requires a positive amount',
      );
      return;
    }

    if (context.order.paidAmountMinor > 0) {
      await this.decision.reject(
        context,
        ReasonCode.PaymentAlreadyCaptured,
        'Payment was already captured for this order',
      );
      return;
    }

    await this.applyStatusWhenCurrent(context, OrderStatus.Paid, {
      paidAmountMinor: amountMinor,
      status: OrderStatus.Paid,
    });
  }

  async cancelOrder(context: OrderEventHandlingContext): Promise<void> {
    if (!context.order) {
      await this.rejectOrderNotReady(context);
      return;
    }

    await this.applyStatusWhenCurrent(context, OrderStatus.Cancelled, {
      status: OrderStatus.Cancelled,
    });
  }

  async issueRefund(context: OrderEventHandlingContext): Promise<void> {
    if (!context.order) {
      await this.rejectOrderNotReady(context);
      return;
    }

    const refundAmountMinor = await this.readRefundAmountMinor(context);

    if (refundAmountMinor === null) {
      await this.decision.reject(
        context,
        ReasonCode.RefundAmountRequired,
        'REFUND_ISSUED requires a positive refundAmount',
      );
      return;
    }

    if (refundAmountMinor > (await this.refundableAmountMinor(context))) {
      await this.decision.reject(
        context,
        ReasonCode.RefundExceedsCaptured,
        'Refund amount exceeds captured payment',
      );
      return;
    }

    const refundedAmountMinor =
      context.order.refundedAmountMinor + refundAmountMinor;
    const nextStatus = await this.refundStatus(context, refundedAmountMinor);

    await this.applyStatusWhenCurrent(context, nextStatus, {
      refundedAmountMinor,
      status: nextStatus,
    });
  }

  private async applyStatusWhenCurrent(
    context: OrderEventHandlingContext,
    toStatus: OrderStatus,
    changedFields: JsonObject,
  ): Promise<void> {
    if (!(await this.fieldVersions.canApplyStatus(context))) {
      await this.decision.rejectObsoleteStatus(context);
      return;
    }

    await context.manager.getRepository(OrderEntity).update(
      { orderId: context.event.orderId },
      {
        ...changedFields,
        updatedAt: new Date().toISOString(),
      },
    );

    await this.fieldVersions.upsertFieldVersion(
      context.manager,
      context.event.orderId,
      OrderVersionedField.Status,
      context.event.timestamp,
      context.event.eventId,
    );

    await this.decision.accept(
      context,
      context.order?.status ?? null,
      toStatus,
      changedFields,
    );
  }

  private async readRefundAmountMinor(
    context: OrderEventHandlingContext,
  ): Promise<number | null> {
    return (
      (await this.money.readPositiveAmountMinor(
        context.event.payload,
        'refundAmount',
      )) ??
      (await this.money.readPositiveAmountMinor(
        context.event.payload,
        'amount',
      ))
    );
  }

  private async refundableAmountMinor(
    context: OrderEventHandlingContext,
  ): Promise<number> {
    await Promise.resolve();

    return context.order!.paidAmountMinor - context.order!.refundedAmountMinor;
  }

  private async refundStatus(
    context: OrderEventHandlingContext,
    refundedAmountMinor: number,
  ): Promise<OrderStatus> {
    await Promise.resolve();

    return refundedAmountMinor === context.order!.paidAmountMinor
      ? OrderStatus.Refunded
      : OrderStatus.PartiallyRefunded;
  }

  private async rejectOrderNotReady(
    context: OrderEventHandlingContext,
  ): Promise<void> {
    await this.decision.reject(
      context,
      ReasonCode.OrderNotReady,
      'Event requires an existing order',
    );
  }
}
