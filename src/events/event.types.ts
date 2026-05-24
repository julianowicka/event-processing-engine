import type { JsonObject, JsonValue } from '../common/json.types';

export type {
  EventProjection,
  QueuedEventRecord,
  QueuedEventResult,
  QueueEventsRequest,
  QueueEventsResponse,
  QueueEventInput,
} from './events.types';

export enum SupportedEventType {
  OrderCreated = 'ORDER_CREATED',
  OrderUpdated = 'ORDER_UPDATED',
  PaymentCaptured = 'PAYMENT_CAPTURED',
  OrderCancelled = 'ORDER_CANCELLED',
  RefundIssued = 'REFUND_ISSUED',
}

export enum OrderStatus {
  Created = 'CREATED',
  Paid = 'PAID',
  Cancelled = 'CANCELLED',
  PartiallyRefunded = 'PARTIALLY_REFUNDED',
  Refunded = 'REFUNDED',
}

export enum JobStatus {
  Pending = 'PENDING',
  Deferred = 'DEFERRED',
  Done = 'DONE',
  DeadLettered = 'DEAD_LETTERED',
}

export enum EngineDecision {
  Accepted = 'ACCEPTED',
  PartiallyApplied = 'PARTIALLY_APPLIED',
  Rejected = 'REJECTED',
  Duplicate = 'DUPLICATE',
  Deferred = 'DEFERRED',
  Failed = 'FAILED',
}

export enum ReasonCode {
  Applied = 'APPLIED',
  PartialMerge = 'PARTIAL_MERGE',
  DuplicateEvent = 'DUPLICATE_EVENT',
  InvalidSchema = 'INVALID_SCHEMA',
  UnknownEventType = 'UNKNOWN_EVENT_TYPE',
  OrderNotReady = 'ORDER_NOT_READY',
  OrderAlreadyExists = 'ORDER_ALREADY_EXISTS',
  ForbiddenTransition = 'FORBIDDEN_TRANSITION',
  ObsoleteEvent = 'OBSOLETE_EVENT',
  ObsoleteField = 'OBSOLETE_FIELD',
  NoApplicableChanges = 'NO_APPLICABLE_CHANGES',
  PaymentAmountRequired = 'PAYMENT_AMOUNT_REQUIRED',
  PaymentAlreadyCaptured = 'PAYMENT_ALREADY_CAPTURED',
  RefundAmountRequired = 'REFUND_AMOUNT_REQUIRED',
  RefundExceedsCaptured = 'REFUND_EXCEEDS_CAPTURED',
  ProcessingError = 'PROCESSING_ERROR',
}

export enum OrderVersionedField {
  Status = 'status',
  AmountMinor = 'amountMinor',
  Currency = 'currency',
}

export const supportedEventTypes = Object.values(SupportedEventType);

export const orderStatuses = Object.values(OrderStatus);

export type OrderHistoryDecision =
  | EngineDecision.Accepted
  | EngineDecision.PartiallyApplied;

export interface ProcessingJobRow {
  job_id: number;
  raw_incoming_event_id: number;
  status: JobStatus;
  attempts: number;
  locked_by: string | null;
  locked_at: string | null;
  raw_event_json: string;
  event_id: string | null;
  order_id: string | null;
  type: string | null;
  event_timestamp: number | null;
}

export interface ValidOrderEvent {
  eventId: string;
  orderId: string;
  type: SupportedEventType;
  timestamp: number;
  payload: JsonObject;
}

export interface OrderRow {
  order_id: string;
  status: OrderStatus;
  amount_minor: number | null;
  currency: string | null;
  paid_amount_minor: number;
  refunded_amount_minor: number;
  version: number;
  max_accepted_event_timestamp: number;
  last_accepted_event_id: string;
  created_at: string;
  updated_at: string;
}

export interface ProcessJobOutcome {
  orderChanged: boolean;
}

export interface EventDecisionDetails {
  id: number;
  rawIncomingEventId: number;
  processingJobId: number;
  eventId: string | null;
  orderId: string | null;
  type: string | null;
  timestamp: number | null;
  decision: EngineDecision;
  reasonCode: ReasonCode;
  reasonMessage: string;
  details: JsonObject;
  processingTimeMs: number;
  createdAt: string;
}

export interface EventDeliveryDetails {
  rawIncomingEventId: number;
  eventId: string | null;
  orderId: string | null;
  type: string | null;
  timestamp: number | null;
  receivedAt: string;
  payload: JsonObject | null;
  rawEvent: JsonValue;
  processingJob: {
    id: number;
    status: JobStatus;
    availableAt: string;
    attempts: number;
    lastReasonCode: string | null;
    createdAt: string;
    updatedAt: string;
    latestDecision: EventDecisionDetails | null;
  } | null;
}

export interface EventHistoryDetails {
  id: number;
  orderId: string;
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

export interface EventDetailsResponse {
  eventId: string;
  orderIds: string[];
  deliveries: EventDeliveryDetails[];
  decisions: EventDecisionDetails[];
  history: EventHistoryDetails[];
}
