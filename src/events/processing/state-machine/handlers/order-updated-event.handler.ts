import { Injectable } from '@nestjs/common';
import { EngineDecision, SupportedEventType } from '../../../event.types';
import type { ValidOrderEvent } from '../../../event.types';
import { EventDecisionService } from '../../event-decision.service';
import {
  OrderEventStateMachineResultKind,
  type OrderEventStateMachineContext,
  type OrderEventStateMachineResult,
} from '../../event-processing.types';
import { OrderUpdatedEventFieldsService } from '../order-updated-event-fields.service';
import type { OrderEventHandler } from './order-event-handler';

@Injectable()
export class OrderUpdatedEventHandler implements OrderEventHandler {
  readonly type = SupportedEventType.OrderUpdated;

  constructor(
    private readonly orderUpdatedEventFields: OrderUpdatedEventFieldsService,
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

    const mutation =
      this.orderUpdatedEventFields.buildChangesFromOrderUpdatedEvent(
        event,
        context.order,
        (fieldName) => context.canApplyField(fieldName),
      );
    const decision = this.decisionService.stateMutationResult(
      event,
      mutation.fields,
    );

    if (decision.decision === EngineDecision.Rejected) {
      return { kind: OrderEventStateMachineResultKind.Rejected, decision };
    }

    return {
      kind: OrderEventStateMachineResultKind.Mutation,
      order: context.order,
      nextState: mutation.nextState,
      fields: mutation.fields,
      decision,
    };
  }
}
