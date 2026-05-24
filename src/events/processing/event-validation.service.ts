import { Injectable } from '@nestjs/common';
import {
  OrderStatus,
  orderStatuses,
  ProcessingJobRow,
  supportedEventTypes,
  SupportedEventType,
  ValidOrderEvent,
} from '../event.types';
import type { EventValidationResult } from './event-processing.types';

@Injectable()
export class EventValidationService {
  validateRawEvent(job: ProcessingJobRow): EventValidationResult {
    const raw = JSON.parse(job.raw_event_json) as unknown;

    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return {
        valid: false,
        reasonCode: 'INVALID_SCHEMA',
        reasonMessage: 'Event item must be a JSON object',
      };
    }

    const record = raw as Record<string, unknown>;
    const eventId = this.readRequiredString(record.eventId);
    const orderId = this.readRequiredString(record.orderId);
    const timestamp = this.readRequiredTimestamp(record.timestamp);
    const payload = this.readPayload(record.payload);

    if (!eventId || !orderId || timestamp === null || !payload.valid) {
      return {
        valid: false,
        reasonCode: 'INVALID_SCHEMA',
        reasonMessage:
          'Event is missing required fields or has invalid payload',
        details: {
          eventId: Boolean(eventId),
          orderId: Boolean(orderId),
          timestamp: timestamp !== null,
          payload: payload.valid,
        },
      };
    }

    if (typeof record.type !== 'string') {
      return {
        valid: false,
        reasonCode: 'INVALID_SCHEMA',
        reasonMessage: 'Event type must be a string',
      };
    }

    if (!supportedEventTypes.includes(record.type as SupportedEventType)) {
      return {
        valid: false,
        reasonCode: 'UNKNOWN_EVENT_TYPE',
        reasonMessage: `Unsupported event type: ${record.type}`,
      };
    }

    const event = {
      eventId,
      orderId,
      type: record.type as SupportedEventType,
      timestamp,
      payload: payload.value,
    };
    const payloadError = this.validatePayloadValues(event);

    if (payloadError) {
      return payloadError;
    }

    return { valid: true, event };
  }

  partialEventFromJob(job: ProcessingJobRow): Partial<ValidOrderEvent> {
    return {
      eventId: job.event_id ?? undefined,
      orderId: job.order_id ?? undefined,
      type: supportedEventTypes.includes(job.type as SupportedEventType)
        ? (job.type as SupportedEventType)
        : undefined,
      timestamp: job.event_timestamp ?? undefined,
    };
  }

  readOrderStatus(value: unknown): OrderStatus {
    if (
      typeof value !== 'string' ||
      !orderStatuses.includes(value as OrderStatus)
    ) {
      throw new Error('Invalid order status');
    }

    return value as OrderStatus;
  }

  optionalCurrency(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
      throw new Error('Invalid currency field');
    }

    return value;
  }

  optionalMoneyToMinor(value: unknown): number | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error('Invalid money field');
    }

    const minor = Math.round(value * 100);

    if (Math.abs(value * 100 - minor) > 1e-6) {
      throw new Error('Money field supports at most two decimal places');
    }

    return minor;
  }

  positiveMoneyToMinor(value: unknown): number | null {
    try {
      const minor = this.optionalMoneyToMinor(value);
      return minor !== null && minor > 0 ? minor : null;
    } catch {
      return null;
    }
  }

  private validatePayloadValues(event: ValidOrderEvent): {
    valid: false;
    reasonCode: 'INVALID_SCHEMA';
    reasonMessage: string;
  } | null {
    try {
      if (Object.prototype.hasOwnProperty.call(event.payload, 'amount')) {
        this.optionalMoneyToMinor(event.payload.amount);
      }

      if (Object.prototype.hasOwnProperty.call(event.payload, 'refundAmount')) {
        this.optionalMoneyToMinor(event.payload.refundAmount);
      }

      if (Object.prototype.hasOwnProperty.call(event.payload, 'currency')) {
        this.optionalCurrency(event.payload.currency);
      }

      if (Object.prototype.hasOwnProperty.call(event.payload, 'status')) {
        this.readOrderStatus(event.payload.status);
      }
    } catch (error) {
      return {
        valid: false,
        reasonCode: 'INVALID_SCHEMA',
        reasonMessage:
          error instanceof Error ? error.message : 'Invalid payload values',
      };
    }

    return null;
  }

  private readPayload(
    value: unknown,
  ): { valid: true; value: Record<string, unknown> } | { valid: false } {
    if (value === undefined) {
      return { valid: true, value: {} };
    }

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { valid: false };
    }

    return { valid: true, value: value as Record<string, unknown> };
  }

  private readRequiredString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private readRequiredTimestamp(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
}
