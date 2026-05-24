import type {
  EngineDecision,
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

export type EventValidationResult =
  | { valid: true; event: ValidOrderEvent }
  | {
      valid: false;
      reasonCode: ReasonCode;
      reasonMessage: string;
      details?: Record<string, unknown>;
    };
