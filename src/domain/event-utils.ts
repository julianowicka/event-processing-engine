import {
  EVENT_TYPES,
  EventType,
  IncomingEvent,
  ORDER_STATUSES,
  OrderStatus,
} from './types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

export function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function isEventType(value: string): value is EventType {
  return EVENT_TYPES.includes(value as EventType);
}

export function isOrderStatus(value: string): value is OrderStatus {
  return ORDER_STATUSES.includes(value as OrderStatus);
}

export interface ValidationResult {
  ok: boolean;
  event?: IncomingEvent;
  reasonMessage?: string;
}

export function validateIncomingEvent(rawEvent: unknown): ValidationResult {
  if (!isRecord(rawEvent)) {
    return { ok: false, reasonMessage: 'Event item must be a JSON object' };
  }

  const eventId = optionalString(rawEvent.eventId);
  if (!eventId) {
    return { ok: false, reasonMessage: 'eventId must be a non-empty string' };
  }

  const orderId = optionalString(rawEvent.orderId);
  if (!orderId) {
    return { ok: false, reasonMessage: 'orderId must be a non-empty string' };
  }

  const type = optionalString(rawEvent.type);
  if (!type) {
    return { ok: false, reasonMessage: 'type must be a non-empty string' };
  }
  if (!isEventType(type)) {
    return { ok: false, reasonMessage: `Unsupported event type: ${type}` };
  }

  const timestamp = optionalNumber(rawEvent.timestamp);
  if (timestamp === null || timestamp <= 0 || !Number.isInteger(timestamp)) {
    return {
      ok: false,
      reasonMessage: 'timestamp must be a positive integer Unix timestamp',
    };
  }

  const payload = rawEvent.payload;
  if (payload !== undefined && !isRecord(payload)) {
    return { ok: false, reasonMessage: 'payload must be a JSON object' };
  }

  return {
    ok: true,
    event: {
      eventId,
      orderId,
      type,
      timestamp,
      payload: isRecord(payload) ? payload : {},
    },
  };
}

export function extractPayloadStatus(payload: Record<string, unknown>) {
  const status = optionalString(payload.status);
  if (!status) {
    return null;
  }

  return isOrderStatus(status) ? status : null;
}
