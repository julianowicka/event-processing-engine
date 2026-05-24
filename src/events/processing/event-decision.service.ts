import { Injectable } from '@nestjs/common';
import type {
  EngineDecision,
  OrderRow,
  ReasonCode,
  ValidOrderEvent,
} from '../event.types';
import type {
  DecisionDescription,
  FieldChangeSet,
} from './event-processing.types';

@Injectable()
export class EventDecisionService {
  invalidEvent(
    reasonCode: ReasonCode,
    reasonMessage: string,
    details?: Record<string, unknown>,
  ): DecisionDescription {
    return {
      decision: 'REJECTED',
      reasonCode,
      reasonMessage,
      details,
    };
  }

  duplicate(event: ValidOrderEvent): DecisionDescription {
    return {
      decision: 'DUPLICATE',
      reasonCode: 'DUPLICATE_EVENT',
      reasonMessage: `Event ${event.eventId} was already processed or claimed`,
    };
  }

  orderAlreadyExists(event: ValidOrderEvent): DecisionDescription {
    return {
      decision: 'REJECTED',
      reasonCode: 'ORDER_ALREADY_EXISTS',
      reasonMessage: `Order ${event.orderId} already exists`,
    };
  }

  orderCreated(
    event: ValidOrderEvent,
    changedFields: Record<string, unknown>,
  ): DecisionDescription {
    return {
      decision: 'ACCEPTED',
      reasonCode: 'APPLIED',
      reasonMessage: `Order ${event.orderId} was created`,
      details: { changedFields },
    };
  }

  paymentAmountRequired(): DecisionDescription {
    return {
      decision: 'REJECTED',
      reasonCode: 'PAYMENT_AMOUNT_REQUIRED',
      reasonMessage: 'A positive payment amount is required',
    };
  }

  paymentAlreadyCaptured(event: ValidOrderEvent): DecisionDescription {
    return {
      decision: 'REJECTED',
      reasonCode: 'PAYMENT_ALREADY_CAPTURED',
      reasonMessage: `Order ${event.orderId} already has a captured payment`,
    };
  }

  forbiddenPayment(
    event: ValidOrderEvent,
    order: OrderRow,
  ): DecisionDescription {
    return {
      decision: 'REJECTED',
      reasonCode: 'FORBIDDEN_TRANSITION',
      reasonMessage: `Cannot move order ${event.orderId} from ${order.status} to PAID`,
    };
  }

  forbiddenCancellation(
    event: ValidOrderEvent,
    order: OrderRow,
  ): DecisionDescription {
    return {
      decision: 'REJECTED',
      reasonCode: 'FORBIDDEN_TRANSITION',
      reasonMessage: `Cannot move order ${event.orderId} from ${order.status} to CANCELLED`,
    };
  }

  refundAmountRequired(): DecisionDescription {
    return {
      decision: 'REJECTED',
      reasonCode: 'REFUND_AMOUNT_REQUIRED',
      reasonMessage: 'A positive refund amount is required',
    };
  }

  forbiddenRefund(
    event: ValidOrderEvent,
    order: OrderRow,
  ): DecisionDescription {
    return {
      decision: 'REJECTED',
      reasonCode: 'FORBIDDEN_TRANSITION',
      reasonMessage: `Cannot refund order ${event.orderId} from ${order.status}`,
    };
  }

  refundExceedsCaptured(event: ValidOrderEvent): DecisionDescription {
    return {
      decision: 'REJECTED',
      reasonCode: 'REFUND_EXCEEDS_CAPTURED',
      reasonMessage: `Refund would exceed captured payment for order ${event.orderId}`,
    };
  }

  stateMutationResult(
    event: ValidOrderEvent,
    fields: FieldChangeSet,
  ): DecisionDescription {
    const changedKeys = Object.keys(fields.changed);
    const skippedKeys = Object.keys(fields.skipped);

    if (changedKeys.length === 0) {
      const forbiddenTransition = Object.values(fields.skipped).includes(
        'FORBIDDEN_TRANSITION',
      );

      return {
        decision: 'REJECTED',
        reasonCode: forbiddenTransition
          ? 'FORBIDDEN_TRANSITION'
          : 'OBSOLETE_EVENT',
        reasonMessage: forbiddenTransition
          ? `Event ${event.eventId} requested a forbidden transition`
          : `Event ${event.eventId} had no applicable changes`,
        details: { skippedFields: fields.skipped },
      };
    }

    const decision: EngineDecision =
      skippedKeys.length > 0 ? 'PARTIALLY_APPLIED' : 'ACCEPTED';
    const reasonCode: ReasonCode =
      decision === 'PARTIALLY_APPLIED' ? 'PARTIAL_MERGE' : 'APPLIED';

    return {
      decision,
      reasonCode,
      reasonMessage:
        decision === 'PARTIALLY_APPLIED'
          ? `Event ${event.eventId} was partially applied`
          : `Event ${event.eventId} was applied`,
      details: {
        changedFields: fields.changed,
        skippedFields: fields.skipped,
      },
    };
  }

  orderNotReady(event: ValidOrderEvent): DecisionDescription {
    return {
      decision: 'DEFERRED',
      reasonCode: 'ORDER_NOT_READY',
      reasonMessage: `Order ${event.orderId} does not exist yet`,
    };
  }

  processingError(message: string): DecisionDescription {
    return {
      decision: 'FAILED',
      reasonCode: 'PROCESSING_ERROR',
      reasonMessage: message,
    };
  }
}
