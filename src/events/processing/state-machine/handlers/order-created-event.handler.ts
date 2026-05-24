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
import type { OrderEventHandler } from './order-event-handler';

@Injectable()
export class OrderCreatedEventHandler implements OrderEventHandler {
  readonly type = SupportedEventType.OrderCreated;

  constructor(
    private readonly validationService: EventValidationService,
    private readonly decisionService: EventDecisionService,
  ) {}

  apply(
    event: ValidOrderEvent,
    context: OrderEventStateMachineContext,
  ): OrderEventStateMachineResult {
    if (context.order) {
      return {
        kind: OrderEventStateMachineResultKind.Rejected,
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
      status: OrderStatus.Created,
      ...(amountMinor === null ? {} : { amountMinor }),
      ...(currency === null ? {} : { currency }),
    };

    return {
      kind: OrderEventStateMachineResultKind.Created,
      createdOrder: { amountMinor, currency, changedFields },
      decision: this.decisionService.orderCreated(event, changedFields),
    };
  }
}
