import type { JsonObject, JsonValue } from '../common/json.types';

export type {
  EventProjection,
  QueuedEventRecord,
  QueuedEventResult,
  QueueEventsRequest,
  QueueEventsResponse,
  QueueEventInput,
} from './events.types';

export const supportedEventTypes = [
  'ORDER_CREATED',
  'ORDER_UPDATED',
  'PAYMENT_CAPTURED',
  'ORDER_CANCELLED',
  'REFUND_ISSUED',
] as const;

export const orderStatuses = [
  'CREATED',
  'PAID',
  'CANCELLED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const;

export type SupportedEventType = (typeof supportedEventTypes)[number];
export type OrderStatus = (typeof orderStatuses)[number];

export type JobStatus = 'PENDING' | 'DEFERRED' | 'DONE' | 'DEAD_LETTERED';

export type EngineDecision =
  | 'ACCEPTED'
  | 'PARTIALLY_APPLIED'
  | 'REJECTED'
  | 'DUPLICATE'
  | 'DEFERRED'
  | 'FAILED';

export type ReasonCode =
  | 'APPLIED'
  | 'PARTIAL_MERGE'
  | 'DUPLICATE_EVENT'
  | 'INVALID_SCHEMA'
  | 'UNKNOWN_EVENT_TYPE'
  | 'ORDER_NOT_READY'
  | 'ORDER_ALREADY_EXISTS'
  | 'FORBIDDEN_TRANSITION'
  | 'OBSOLETE_EVENT'
  | 'OBSOLETE_FIELD'
  | 'NO_APPLICABLE_CHANGES'
  | 'PAYMENT_AMOUNT_REQUIRED'
  | 'PAYMENT_ALREADY_CAPTURED'
  | 'REFUND_AMOUNT_REQUIRED'
  | 'REFUND_EXCEEDS_CAPTURED'
  | 'PROCESSING_ERROR';

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
  decision: 'ACCEPTED' | 'PARTIALLY_APPLIED';
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
