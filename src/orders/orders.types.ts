import type {
  EngineDecision,
  ProcessingStatus,
  OrderHistoryDecision,
  OrderStatus,
} from '../events/types/event.types';
import type { JsonObject } from '../common/json.types';

export interface OrderCurrentState {
  orderId: string;
  status: OrderStatus;
  amount: number | null;
  currency: string | null;
  paidAmount: number;
  refundedAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderHistoryEntry {
  id: number;
  eventId: string;
  type: string;
  timestamp: number;
  processedAt: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  changedFields: JsonObject;
  skippedFields: JsonObject;
  decision: OrderHistoryDecision;
  reasonCode: string;
  createdAt: string;
}

export interface OrderDecisionEntry {
  id: number;
  rawIncomingEventId: number;
  eventId: string | null;
  orderId: string | null;
  type: string | null;
  timestamp: number | null;
  decision: EngineDecision;
  reasonCode: string;
  reasonMessage: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  changedFields: JsonObject;
  skippedFields: JsonObject;
  processingTimeMs: number;
  createdAt: string;
}

export interface OrderPendingJob {
  id: number;
  rawIncomingEventId: number;
  status: ProcessingStatus;
  availableAt: string;
  attempts: number;
  lastErrorMessage: string | null;
  eventId: string | null;
  orderId: string | null;
  type: string | null;
  timestamp: number | null;
  receivedAt: string;
}

export interface OrderDetailsResponse {
  orderId: string;
  currentState: OrderCurrentState | null;
  history: OrderHistoryEntry[];
  rejectedEvents: OrderDecisionEntry[];
  pendingJobs: OrderPendingJob[];
  auditLog: OrderDecisionEntry[];
}
