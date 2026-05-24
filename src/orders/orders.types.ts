import type {
  EngineDecision,
  JobStatus,
  OrderStatus,
} from '../events/event.types';

export interface OrderCurrentState {
  orderId: string;
  status: OrderStatus;
  amountMinor: number | null;
  currency: string | null;
  paidAmountMinor: number;
  refundedAmountMinor: number;
  version: number;
  maxAcceptedEventTimestamp: number;
  lastAcceptedEventId: string;
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
  changedFields: Record<string, unknown>;
  skippedFields: Record<string, unknown>;
  decision: 'ACCEPTED' | 'PARTIALLY_APPLIED';
  reasonCode: string;
  createdAt: string;
}

export interface OrderDecisionEntry {
  id: number;
  rawIncomingEventId: number;
  processingJobId: number;
  eventId: string | null;
  orderId: string | null;
  type: string | null;
  timestamp: number | null;
  decision: EngineDecision;
  reasonCode: string;
  reasonMessage: string;
  details: Record<string, unknown>;
  processingTimeMs: number;
  createdAt: string;
}

export interface OrderPendingJob {
  id: number;
  rawIncomingEventId: number;
  status: JobStatus;
  availableAt: string;
  attempts: number;
  lastReasonCode: string | null;
  eventId: string | null;
  orderId: string | null;
  type: string | null;
  timestamp: number | null;
  latestDecision: OrderDecisionEntry | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderDetailsResponse {
  orderId: string;
  currentState: OrderCurrentState | null;
  history: OrderHistoryEntry[];
  rejectedEvents: OrderDecisionEntry[];
  pendingJobs: OrderPendingJob[];
  auditLog: OrderDecisionEntry[];
}
