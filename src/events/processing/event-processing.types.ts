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
  details?: Record<string, unknown>;
  processingTimeMs: number;
}

export interface DecisionResult {
  decisionId: number;
}

export interface DecisionDescription {
  decision: EngineDecision;
  reasonCode: ReasonCode;
  reasonMessage: string;
  details?: Record<string, unknown>;
}

export interface FieldChangeSet {
  changed: Record<string, unknown>;
  skipped: Record<string, unknown>;
}

export interface NextOrderState {
  status: OrderStatus;
  amountMinor: number | null;
  currency: string | null;
  paidAmountMinor: number;
  refundedAmountMinor: number;
}

export interface OrderEventApplicationContext {
  order: OrderRow | null;
  canApplyField(fieldName: string): boolean;
  hasPendingPaymentForOrder(): boolean;
}

export interface CreatedOrderApplication {
  amountMinor: number | null;
  currency: string | null;
  changedFields: Record<string, unknown>;
}

export type OrderEventApplicationResult =
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
      details?: Record<string, unknown>;
    };
