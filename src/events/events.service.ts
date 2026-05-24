import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { JsonObject, JsonValue } from '../common/json.types';
import { isJsonObject } from '../common/json.util';
import type {
  EventProjection,
  QueueEventInput,
  QueueEventsRequest,
  QueuedEventResult,
  QueuedEventRecord,
  QueueEventsResponse,
} from './events.types';
import { EventsRepository } from './events.repository';
import { EventWorkerService } from './event-worker.service';
import { verboseLog } from './event-verbose-logger';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly eventsRepository: EventsRepository,
    private readonly eventWorkerService: EventWorkerService,
  ) {}

  enqueueBatch(body: JsonValue): QueueEventsResponse {
    if (!this.isQueueEventsRequest(body)) {
      throw new BadRequestException('Request body must be a JSON array');
    }

    const projections: EventProjection[] = body.map((eventItem) =>
      this.projectEvent(eventItem),
    );
    const results: QueuedEventResult[] = this.eventsRepository
      .enqueueBatch(projections)
      .map((queuedEvent) => this.toQueuedEventResult(queuedEvent));

    verboseLog(this.logger, 'batch queued', {
      queued: results.length,
      incomingEventIds: results.map((result) => result.incomingEventId),
      processingJobIds: results.map((result) => result.processingJobId),
    });

    this.eventWorkerService.nudge();

    return {
      mode: 'ASYNC_WORKER',
      results,
      summary: {
        queued: results.length,
      },
    };
  }

  private toQueuedEventResult(
    queuedEvent: QueuedEventRecord,
  ): QueuedEventResult {
    const { projection } = queuedEvent;

    return {
      incomingEventId: queuedEvent.incomingEventId,
      processingJobId: queuedEvent.processingJobId,
      eventId: projection.eventId,
      orderId: projection.orderId,
      type: projection.type,
      status: 'QUEUED',
      reasonCode: null,
      reasonMessage: 'Event queued for background processing',
      processingTimeMs: 0,
    };
  }

  private projectEvent(eventItem: QueueEventInput): EventProjection {
    const record = this.asRecord(eventItem);
    const payload = record ? this.asRecord(record.payload) : null;

    return {
      eventId: record ? this.readNonEmptyString(record.eventId) : null,
      orderId: record ? this.readNonEmptyString(record.orderId) : null,
      type: record ? this.readNonEmptyString(record.type) : null,
      timestamp: record ? this.readFiniteNumber(record.timestamp) : null,
      payloadJson: payload ? this.stringifyJson(payload) : null,
      rawEventJson: this.stringifyJson(eventItem),
    };
  }

  private asRecord(value: JsonValue | undefined): JsonObject | null {
    return isJsonObject(value) ? value : null;
  }

  private readNonEmptyString(value: JsonValue | undefined): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private readFiniteNumber(value: JsonValue | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    return value;
  }

  private stringifyJson(value: JsonValue): string {
    return JSON.stringify(value) ?? 'null';
  }

  private isQueueEventsRequest(body: JsonValue): body is QueueEventsRequest {
    return Array.isArray(body);
  }
}
