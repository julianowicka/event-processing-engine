import { Injectable } from '@nestjs/common';
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
    canApplyField: (fieldName: string) => boolean,
  ): { nextState: NextOrderState; fields: FieldChangeSet } {
    const fields: FieldChangeSet = { changed: {}, skipped: {} };
    let nextAmountMinor = order.amount_minor;
    let nextCurrency = order.currency;
    let nextStatus = order.status;

    if (Object.prototype.hasOwnProperty.call(event.payload, 'amount')) {
      const amountMinor = this.validationService.optionalMoneyToMinor(
        event.payload.amount,
      );
      if (canApplyField('amountMinor')) {
        nextAmountMinor = amountMinor;
        fields.changed.amountMinor = amountMinor;
      } else {
        fields.skipped.amountMinor = 'OBSOLETE_FIELD';
      }
    }

    if (Object.prototype.hasOwnProperty.call(event.payload, 'currency')) {
      const currency = this.validationService.optionalCurrency(
        event.payload.currency,
      );
      if (canApplyField('currency')) {
        nextCurrency = currency;
        fields.changed.currency = currency;
      } else {
        fields.skipped.currency = 'OBSOLETE_FIELD';
      }
    }

    if (Object.prototype.hasOwnProperty.call(event.payload, 'status')) {
      const requestedStatus = this.validationService.readOrderStatus(
        event.payload.status,
      );
      if (!canApplyField('status')) {
        fields.skipped.status = 'OBSOLETE_FIELD';
      } else if (
        !this.statusTransitionRules.canEventChangeStatus(
          event.type,
          order.status,
          requestedStatus,
        )
      ) {
        fields.skipped.status = 'FORBIDDEN_TRANSITION';
      } else {
        nextStatus = requestedStatus;
        fields.changed.status = requestedStatus;
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
