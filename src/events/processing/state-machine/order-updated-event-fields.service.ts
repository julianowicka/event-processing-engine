import { Injectable } from '@nestjs/common';
import { OrderVersionedField, ReasonCode } from '../../event.types';
import type { OrderRow, ValidOrderEvent } from '../../event.types';
import type { FieldChangeSet, NextOrderState } from '../event-processing.types';
import { EventValidationService } from '../event-validation.service';
import { OrderStatusTransitionRulesService } from './order-status-transition-rules.service';

@Injectable()
export class OrderUpdatedEventFieldsService {
  constructor(
    private readonly validationService: EventValidationService,
    private readonly statusTransitionRules: OrderStatusTransitionRulesService,
  ) {}

  buildChangesFromOrderUpdatedEvent(
    event: ValidOrderEvent,
    order: OrderRow,
    canApplyField: (fieldName: OrderVersionedField) => boolean,
  ): { nextState: NextOrderState; fields: FieldChangeSet } {
    const fields: FieldChangeSet = { changed: {}, skipped: {} };
    let nextAmountMinor = order.amount_minor;
    let nextCurrency = order.currency;
    let nextStatus = order.status;

    if (Object.prototype.hasOwnProperty.call(event.payload, 'amount')) {
      const amountMinor = this.validationService.optionalMoneyToMinor(
        event.payload.amount,
      );
      if (canApplyField(OrderVersionedField.AmountMinor)) {
        nextAmountMinor = amountMinor;
        fields.changed[OrderVersionedField.AmountMinor] = amountMinor;
      } else {
        fields.skipped[OrderVersionedField.AmountMinor] =
          ReasonCode.ObsoleteField;
      }
    }

    if (Object.prototype.hasOwnProperty.call(event.payload, 'currency')) {
      const currency = this.validationService.optionalCurrency(
        event.payload.currency,
      );
      if (canApplyField(OrderVersionedField.Currency)) {
        nextCurrency = currency;
        fields.changed[OrderVersionedField.Currency] = currency;
      } else {
        fields.skipped[OrderVersionedField.Currency] = ReasonCode.ObsoleteField;
      }
    }

    if (Object.prototype.hasOwnProperty.call(event.payload, 'status')) {
      const requestedStatus = this.validationService.readOrderStatus(
        event.payload.status,
      );
      if (!canApplyField(OrderVersionedField.Status)) {
        fields.skipped[OrderVersionedField.Status] = ReasonCode.ObsoleteField;
      } else if (
        !this.statusTransitionRules.canEventChangeStatus(
          event.type,
          order.status,
          requestedStatus,
        )
      ) {
        fields.skipped[OrderVersionedField.Status] =
          ReasonCode.ForbiddenTransition;
      } else {
        nextStatus = requestedStatus;
        fields.changed[OrderVersionedField.Status] = requestedStatus;
      }
    }

    return {
      nextState: {
        status: nextStatus,
        amountMinor: nextAmountMinor,
        currency: nextCurrency,
        paidAmountMinor: order.paid_amount_minor,
        refundedAmountMinor: order.refunded_amount_minor,
      },
      fields,
    };
  }
}
