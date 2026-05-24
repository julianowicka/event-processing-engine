import type { JsonValue } from '../common/json.types';

export type QueueEventInput = JsonValue;

export type QueueEventsRequest = QueueEventInput[];

export interface EventProjection {
  eventId: string | null;
  orderId: string | null;
  type: string | null;
  timestamp: number | null;
  payloadJson: string | null;
  rawEventJson: string;
}

export interface QueuedEventRecord {
  incomingEventId: number;
  processingJobId: number;
  projection: EventProjection;
}

export enum QueuedEventStatus {
  Queued = 'QUEUED',
}

export enum QueueEventsMode {
  AsyncWorker = 'ASYNC_WORKER',
}

export interface QueuedEventResult {
  incomingEventId: number;
  processingJobId: number;
  eventId: string | null;
  orderId: string | null;
  type: string | null;
  status: QueuedEventStatus;
  reasonCode: null;
  reasonMessage: string;
  processingTimeMs: 0;
}

export interface QueueEventsResponse {
  mode: QueueEventsMode;
  results: QueuedEventResult[];
  summary: {
    queued: number;
  };
}
