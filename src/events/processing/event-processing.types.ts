import type { JsonObject } from '../../common/json.types';
import type {
  EngineDecision,
  OrderRow,
  OrderStatus,
  ProcessingJobRow,
  ReasonCode,
  ValidOrderEvent,
} from '../event.types';

export interface DecisionInput {
  job: ProcessingJobRow;
  event: Partial<ValidOrderEvent>;
  decision: EngineDecision;
  reasonCode: ReasonCode;
  reasonMessage: string;
  details?: JsonObject;
  processingTimeMs: number;
}

export interface DecisionResult {
  decisionId: number;
}

export interface DecisionDescription {
  decision: EngineDecision;
  reasonCode: ReasonCode;
  reasonMessage: string;
  details?: JsonObject;
}

export interface FieldChangeSet {
  changed: JsonObject;
  skipped: JsonObject;
}

export interface NextOrderState {
  status: OrderStatus;
  amountMinor: number | null;
  currency: string | null;
  paidAmountMinor: number;
  refundedAmountMinor: number;
}

export interface OrderEventStateMachineContext {
  order: OrderRow | null;
  canApplyField(fieldName: string): boolean;
  hasPendingPaymentForOrder(): boolean;
}

export interface CreatedOrderApplication {
  amountMinor: number | null;
  currency: string | null;
  changedFields: JsonObject;
}

export type OrderEventStateMachineResult =
  | {
      kind: 'CREATED';
      createdOrder: CreatedOrderApplication;
    }
  | {
      kind: 'MUTATION';
      order: OrderRow;
      nextState: NextOrderState;
      fields: FieldChangeSet;
    }
  | {
      kind: 'REJECTED';
      decision: DecisionDescription;
    }
  | {
      kind: 'DEFERRED';
      decision: DecisionDescription;
    };

export type EventValidationResult =
  | { valid: true; event: ValidOrderEvent }
  | {
      valid: false;
      reasonCode: ReasonCode;
      reasonMessage: string;
      details?: JsonObject;
    };
