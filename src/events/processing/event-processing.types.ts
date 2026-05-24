import type { JsonObject } from '../../common/json.types';
import type {
  EngineDecision,
  OrderRow,
  OrderStatus,
  OrderVersionedField,
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

export type AppliedDecisionDescription = DecisionDescription & {
  decision: EngineDecision.Accepted | EngineDecision.PartiallyApplied;
};

export type StateMutationDecision =
  | AppliedDecisionDescription
  | (DecisionDescription & { decision: EngineDecision.Rejected });

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
  canApplyField(fieldName: OrderVersionedField): boolean;
  hasPendingPaymentForOrder(): boolean;
}

export interface CreatedOrderApplication {
  amountMinor: number | null;
  currency: string | null;
  changedFields: JsonObject;
}

export enum OrderEventStateMachineResultKind {
  Created = 'CREATED',
  Mutation = 'MUTATION',
  Rejected = 'REJECTED',
  Deferred = 'DEFERRED',
}

export type OrderEventStateMachineResult =
  | {
      kind: OrderEventStateMachineResultKind.Created;
      createdOrder: CreatedOrderApplication;
      decision: AppliedDecisionDescription;
    }
  | {
      kind: OrderEventStateMachineResultKind.Mutation;
      order: OrderRow;
      nextState: NextOrderState;
      fields: FieldChangeSet;
      decision: AppliedDecisionDescription;
    }
  | {
      kind: OrderEventStateMachineResultKind.Rejected;
      decision: DecisionDescription;
    }
  | {
      kind: OrderEventStateMachineResultKind.Deferred;
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
