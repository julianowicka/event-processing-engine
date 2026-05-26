import type { JsonObject } from '../../../../src/common/json.types';

export interface TestEvent extends JsonObject {
  eventId: string;
  orderId: string;
  type: string;
  timestamp: number;
  payload: JsonObject | null;
}

export function uniqueRunId(prefix = 'smoke'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function orderId(runId: string): string {
  return `ord-${runId}`;
}

export function eventId(runId: string, index: number): string {
  return `evt-${runId}-${index.toString().padStart(3, '0')}`;
}

export function createdEvent(
  runId: string,
  index: number,
  overrides: Partial<TestEvent> = {},
): TestEvent {
  const id = orderId(runId);

  return {
    eventId: eventId(runId, index),
    orderId: id,
    type: 'ORDER_CREATED',
    timestamp: 1710001000,
    payload: { amount: 100, currency: 'PLN' },
    ...overrides,
  };
}

export function paidEvent(
  runId: string,
  index: number,
  overrides: Partial<TestEvent> = {},
): TestEvent {
  return {
    eventId: eventId(runId, index),
    orderId: orderId(runId),
    type: 'PAYMENT_CAPTURED',
    timestamp: 1710002000,
    payload: { amount: 100 },
    ...overrides,
  };
}

export function refundedEvent(
  runId: string,
  index: number,
  overrides: Partial<TestEvent> = {},
): TestEvent {
  return {
    eventId: eventId(runId, index),
    orderId: orderId(runId),
    type: 'REFUND_ISSUED',
    timestamp: 1710003000,
    payload: { refundAmount: 25 },
    ...overrides,
  };
}

export function cancelledEvent(
  runId: string,
  index: number,
  overrides: Partial<TestEvent> = {},
): TestEvent {
  return {
    eventId: eventId(runId, index),
    orderId: orderId(runId),
    type: 'ORDER_CANCELLED',
    timestamp: 1710002500,
    payload: {},
    ...overrides,
  };
}

export function updatedEvent(
  runId: string,
  index: number,
  overrides: Partial<TestEvent> = {},
): TestEvent {
  return {
    eventId: eventId(runId, index),
    orderId: orderId(runId),
    type: 'ORDER_UPDATED',
    timestamp: 1710002500,
    payload: { amount: 125, currency: 'EUR' },
    ...overrides,
  };
}
