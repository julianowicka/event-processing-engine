import { Injectable } from '@nestjs/common';
import type { DeepPartial } from 'typeorm';
import { isJsonObject } from '../../common/json.util';
import type { RawIncomingEventEntity } from '../../database/entities';
import { ProcessingStatus } from '../types/event.types';
import {
  type QueueEventInput,
  type QueueEventsRequest,
  type QueuedEventResult,
  QueuedEventStatus,
} from '../types/events.types';

type RawIncomingEventRow = DeepPartial<RawIncomingEventEntity>;

@Injectable()
export class RawEventsFactory {
  createRawIncomingEvents(
    events: QueueEventsRequest,
    receivedAt: string,
  ): RawIncomingEventRow[] {
    return events.map((event) =>
      this.createRawIncomingEvent(event, receivedAt),
    );
  }

  createQueuedEventResults(
    records: RawIncomingEventEntity[],
  ): QueuedEventResult[] {
    return records.map((record) => ({
      incomingEventId: record.id,
      eventId: record.eventId,
      orderId: record.orderId,
      type: record.type,
      status: QueuedEventStatus.Queued,
      reasonCode: null,
      reasonMessage: 'Queued for asynchronous processing',
      processingTimeMs: 0,
    }));
  }

  private createRawIncomingEvent(
    event: QueueEventInput,
    receivedAt: string,
  ): RawIncomingEventRow {
    const rawEventJson = JSON.stringify(event) ?? 'null';

    if (!isJsonObject(event)) {
      return {
        eventId: null,
        orderId: null,
        type: null,
        eventTimestamp: null,
        rawEventJson,
        receivedAt,
        processingStatus: ProcessingStatus.Pending,
        availableAt: receivedAt,
        attempts: 0,
        lastErrorMessage: null,
      };
    }

    return {
      eventId: this.stringOrNull(event.eventId),
      orderId: this.stringOrNull(event.orderId),
      type: this.stringOrNull(event.type),
      eventTimestamp: this.finiteNumberOrNull(event.timestamp),
      rawEventJson,
      receivedAt,
      processingStatus: ProcessingStatus.Pending,
      availableAt: receivedAt,
      attempts: 0,
      lastErrorMessage: null,
    };
  }

  private stringOrNull(value: QueueEventInput | undefined): string | null {
    return typeof value === 'string' ? value : null;
  }

  private finiteNumberOrNull(
    value: QueueEventInput | undefined,
  ): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
}
