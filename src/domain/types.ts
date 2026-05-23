export const EVENT_TYPES = [
  'ORDER_CREATED',
  'ORDER_UPDATED',
  'PAYMENT_CAPTURED',
  'ORDER_CANCELLED',
  'REFUND_ISSUED',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const ORDER_STATUSES = [
  'CREATED',
  'PAID',
  'CANCELLED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type Decision =
  | 'ACCEPTED'
  | 'PARTIALLY_APPLIED'
  | 'REJECTED'
  | 'DUPLICATE'
  | 'DEFERRED'
  | 'FAILED';

export type RawProcessingStatus =
  | 'PENDING'
  | 'DEFERRED'
  | 'DONE'
  | 'DEAD_LETTERED';

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

export interface IncomingEvent {
  eventId: string;
  orderId: string;
  type: EventType;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface RawIncomingEventRecord {
  id: number;
  eventId: string | null;
  orderId: string | null;
  type: string | null;
  eventTimestamp: number | null;
  rawEvent: unknown;
  payload: unknown;
  receivedAt: string;
  availableAt: string;
  processingStatus: RawProcessingStatus;
  attempts: number;
  lastErrorMessage: string | null;
  lastDecisionId: number | null;
  lastReasonCode: ReasonCode | null;
}

export interface ProcessedEventKeyRecord {
  eventId: string;
  firstRawIncomingEventId: number;
  orderId: string | null;
  firstSeenAt: string;
}

export interface OrderRecord {
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

export interface OrderFieldVersionRecord {
  orderId: string;
  fieldName: string;
  lastEventTimestamp: number;
  lastEventId: string;
  updatedAt: string;
}

export interface OrderHistoryRecord {
  id: number;
  orderId: string;
  eventId: string;
  eventType: EventType;
  eventTimestamp: number;
  processedAt: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  changedFields: Record<string, unknown>;
  skippedFields: Record<string, string>;
  decision: Extract<Decision, 'ACCEPTED' | 'PARTIALLY_APPLIED'>;
  reasonCode: ReasonCode;
  createdAt: string;
}

export interface EventDecisionRecord {
  id: number;
  rawIncomingEventId: number;
  eventId: string | null;
  orderId: string | null;
  type: string | null;
  timestamp: number | null;
  decision: Decision;
  reasonCode: ReasonCode;
  reasonMessage: string;
  details: Record<string, unknown>;
  processingTimeMs: number;
  createdAt: string;
}

export interface ProcessingStatsRecord {
  validEventsCount: number;
  acceptedEventsCount: number;
  partiallyAppliedEventsCount: number;
  rejectedEventsCount: number;
  duplicateEventsCount: number;
  processedEventsCount: number;
  totalProcessingTimeMs: number;
  updatedAt: string;
}

export interface DeadLetterEventRecord {
  id: number;
  rawIncomingEventId: number;
  eventId: string | null;
  orderId: string | null;
  type: string | null;
  timestamp: number | null;
  rawEvent: unknown;
  reasonCode: Extract<ReasonCode, 'PROCESSING_ERROR'>;
  errorMessage: string;
  attempts: number;
  createdAt: string;
}

export interface EventEngineDatabase {
  nextIds: {
    rawIncomingEvent: number;
    eventDecision: number;
    orderHistory: number;
    deadLetterEvent: number;
  };
  rawIncomingEvents: RawIncomingEventRecord[];
  processedEventKeys: ProcessedEventKeyRecord[];
  orders: OrderRecord[];
  orderFieldVersions: OrderFieldVersionRecord[];
  orderHistory: OrderHistoryRecord[];
  eventDecisions: EventDecisionRecord[];
  deadLetterEvents: DeadLetterEventRecord[];
  stats: ProcessingStatsRecord;
}

export interface FieldMergeDecision {
  apply: boolean;
  reason?: string;
}
