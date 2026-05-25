import { Injectable } from '@nestjs/common';
import { isJsonObject, parseJsonValue } from '../../../common/json.util';
import type { JsonValue } from '../../../common/json.types';
import type { RawIncomingEventEntity } from '../../../database/entities';
import {
  ReasonCode,
  supportedEventTypes,
  SupportedEventType,
  type ValidOrderEvent,
} from '../../types/event.types';

export interface InvalidEventValidation {
  valid: false;
  reasonCode: ReasonCode.InvalidSchema | ReasonCode.UnknownEventType;
  reasonMessage: string;
}

export interface ValidEventValidation {
  valid: true;
  event: ValidOrderEvent;
}

export type EventValidation = InvalidEventValidation | ValidEventValidation;

@Injectable()
export class EventValidationService {
  async validate(delivery: RawIncomingEventEntity): Promise<EventValidation> {
    const parsed = await this.parseRawEvent(delivery.rawEventJson);

    if (!isJsonObject(parsed)) {
      return await this.invalid(
        ReasonCode.InvalidSchema,
        'Event payload must be a JSON object',
      );
    }

    const rawEvent = parsed;
    const eventId = rawEvent.eventId;
    const orderId = rawEvent.orderId;
    const type = rawEvent.type;
    const timestamp = rawEvent.timestamp;
    const payload = rawEvent.payload;

    if (!(await this.isNonEmptyString(eventId))) {
      return await this.invalid(
        ReasonCode.InvalidSchema,
        'eventId must be a non-empty string',
      );
    }

    if (!(await this.isNonEmptyString(orderId))) {
      return await this.invalid(
        ReasonCode.InvalidSchema,
        'orderId must be a non-empty string',
      );
    }

    if (!(await this.isNonEmptyString(type))) {
      return await this.invalid(
        ReasonCode.InvalidSchema,
        'type must be a non-empty string',
      );
    }

    const eventType = type as string;

    if (!(await this.isSupportedEventType(eventType))) {
      return await this.invalid(
        ReasonCode.UnknownEventType,
        `Event type ${eventType} is not supported`,
      );
    }

    if (!(await this.isFiniteNumber(timestamp))) {
      return await this.invalid(
        ReasonCode.InvalidSchema,
        'timestamp must be a finite number',
      );
    }

    if (!isJsonObject(payload)) {
      return await this.invalid(
        ReasonCode.InvalidSchema,
        'payload must be a JSON object',
      );
    }

    return {
      valid: true,
      event: {
        eventId: eventId as string,
        orderId: orderId as string,
        type: eventType as SupportedEventType,
        timestamp: timestamp as number,
        payload,
      },
    };
  }

  private async parseRawEvent(rawEventJson: string): Promise<JsonValue> {
    await Promise.resolve();

    try {
      return parseJsonValue(rawEventJson);
    } catch {
      return null;
    }
  }

  private async invalid(
    reasonCode: InvalidEventValidation['reasonCode'],
    reasonMessage: string,
  ): Promise<InvalidEventValidation> {
    await Promise.resolve();

    return {
      valid: false,
      reasonCode,
      reasonMessage,
    };
  }

  private async isNonEmptyString(
    value: JsonValue | undefined,
  ): Promise<boolean> {
    await Promise.resolve();

    return typeof value === 'string' && value.trim().length > 0;
  }

  private async isFiniteNumber(value: JsonValue | undefined): Promise<boolean> {
    await Promise.resolve();

    return typeof value === 'number' && Number.isFinite(value);
  }

  private async isSupportedEventType(value: string): Promise<boolean> {
    await Promise.resolve();

    return supportedEventTypes.includes(value as SupportedEventType);
  }
}
