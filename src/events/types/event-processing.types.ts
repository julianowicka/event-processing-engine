import type { JsonObject } from '../../common/json.types';
import type {
  EngineDecision,
  OrderStatus,
  ProcessingDeliveryRow,
  ReasonCode,
  ValidOrderEvent,
} from './event.types';

export interface DecisionInput {
  delivery: ProcessingDeliveryRow;
  event: Partial<ValidOrderEvent>;
  decision: EngineDecision;
  reasonCode: ReasonCode;
  reasonMessage: string;
  fromStatus?: OrderStatus | null;
  toStatus?: OrderStatus | null;
  changedFields?: JsonObject;
  skippedFields?: JsonObject;
  processingTimeMs: number;
}

export interface DecisionResult {
  decisionId: number;
}

export interface NextOrderState {
  status: OrderStatus;
  amountMinor: number | null;
  currency: string | null;
  paidAmountMinor: number;
  refundedAmountMinor: number;
}
