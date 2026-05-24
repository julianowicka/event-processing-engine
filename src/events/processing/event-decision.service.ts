import { Injectable } from '@nestjs/common';
import type { JsonObject } from '../../common/json.types';
import { EngineDecision, OrderStatus, ReasonCode } from '../event.types';
import type { OrderRow, ValidOrderEvent } from '../event.types';
import type {
  AppliedDecisionDescription,
  DecisionDescription,
  FieldChangeSet,
  StateMutationDecision,
} from './event-processing.types';

@Injectable()
export class EventDecisionService {
  invalidEvent(
    reasonCode: ReasonCode,
    reasonMessage: string,
    details?: JsonObject,
  ): DecisionDescription {
    return {
      decision: EngineDecision.Rejected,
      reasonCode,
      reasonMessage,
      details,
    };
  }

  duplicate(event: ValidOrderEvent): DecisionDescription {
    return {
      decision: EngineDecision.Duplicate,
      reasonCode: ReasonCode.DuplicateEvent,
      reasonMessage: `Event ${event.eventId} was already processed or claimed`,
    };
  }

  orderAlreadyExists(event: ValidOrderEvent): DecisionDescription {
    return {
      decision: EngineDecision.Rejected,
      reasonCode: ReasonCode.OrderAlreadyExists,
      reasonMessage: `Order ${event.orderId} already exists`,
    };
  }

  orderCreated(
    event: ValidOrderEvent,
    changedFields: JsonObject,
  ): AppliedDecisionDescription {
    return {
      decision: EngineDecision.Accepted,
      reasonCode: ReasonCode.Applied,
      reasonMessage: `Order ${event.orderId} was created`,
      details: { changedFields },
    };
  }

  paymentAmountRequired(): DecisionDescription {
    return {
      decision: EngineDecision.Rejected,
      reasonCode: ReasonCode.PaymentAmountRequired,
      reasonMessage: 'A positive payment amount is required',
    };
  }

  paymentAlreadyCaptured(event: ValidOrderEvent): DecisionDescription {
    return {
      decision: EngineDecision.Rejected,
      reasonCode: ReasonCode.PaymentAlreadyCaptured,
      reasonMessage: `Order ${event.orderId} already has a captured payment`,
    };
  }

  forbiddenPayment(
    event: ValidOrderEvent,
    order: OrderRow,
  ): DecisionDescription {
    return {
      decision: EngineDecision.Rejected,
      reasonCode: ReasonCode.ForbiddenTransition,
      reasonMessage: `Cannot move order ${event.orderId} from ${order.status} to ${OrderStatus.Paid}`,
    };
  }

  forbiddenCancellation(
    event: ValidOrderEvent,
    order: OrderRow,
  ): DecisionDescription {
    return {
      decision: EngineDecision.Rejected,
      reasonCode: ReasonCode.ForbiddenTransition,
      reasonMessage: `Cannot move order ${event.orderId} from ${order.status} to ${OrderStatus.Cancelled}`,
    };
  }

  refundAmountRequired(): DecisionDescription {
    return {
      decision: EngineDecision.Rejected,
      reasonCode: ReasonCode.RefundAmountRequired,
      reasonMessage: 'A positive refund amount is required',
    };
  }

  forbiddenRefund(
    event: ValidOrderEvent,
    order: OrderRow,
  ): DecisionDescription {
    return {
      decision: EngineDecision.Rejected,
      reasonCode: ReasonCode.ForbiddenTransition,
      reasonMessage: `Cannot refund order ${event.orderId} from ${order.status}`,
    };
  }

  refundExceedsCaptured(event: ValidOrderEvent): DecisionDescription {
    return {
      decision: EngineDecision.Rejected,
      reasonCode: ReasonCode.RefundExceedsCaptured,
      reasonMessage: `Refund would exceed captured payment for order ${event.orderId}`,
    };
  }

  stateMutationResult(
    event: ValidOrderEvent,
    fields: FieldChangeSet,
  ): StateMutationDecision {
    const changedKeys = Object.keys(fields.changed);
    const skippedKeys = Object.keys(fields.skipped);

    if (changedKeys.length === 0) {
      const forbiddenTransition = Object.values(fields.skipped).includes(
        ReasonCode.ForbiddenTransition,
      );

      return {
        decision: EngineDecision.Rejected,
        reasonCode: forbiddenTransition
          ? ReasonCode.ForbiddenTransition
          : ReasonCode.ObsoleteEvent,
        reasonMessage: forbiddenTransition
          ? `Event ${event.eventId} requested a forbidden transition`
          : `Event ${event.eventId} had no applicable changes`,
        details: { skippedFields: fields.skipped },
      };
    }

    if (skippedKeys.length === 0) {
      return this.appliedMutation(event, fields);
    }

    return {
      decision: EngineDecision.PartiallyApplied,
      reasonCode: ReasonCode.PartialMerge,
      reasonMessage: `Event ${event.eventId} was partially applied`,
      details: {
        changedFields: fields.changed,
        skippedFields: fields.skipped,
      },
    };
  }

  appliedMutation(
    event: ValidOrderEvent,
    fields: FieldChangeSet,
  ): AppliedDecisionDescription {
    return {
      decision: EngineDecision.Accepted,
      reasonCode: ReasonCode.Applied,
      reasonMessage: `Event ${event.eventId} was applied`,
      details: {
        changedFields: fields.changed,
        skippedFields: fields.skipped,
      },
    };
  }

  orderNotReady(event: ValidOrderEvent): DecisionDescription {
    return {
      decision: EngineDecision.Deferred,
      reasonCode: ReasonCode.OrderNotReady,
      reasonMessage: `Order ${event.orderId} does not exist yet`,
    };
  }

  processingError(message: string): DecisionDescription {
    return {
      decision: EngineDecision.Failed,
      reasonCode: ReasonCode.ProcessingError,
      reasonMessage: message,
    };
  }
}
