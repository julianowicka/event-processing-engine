import { Injectable } from '@nestjs/common';
import { RawIncomingEventRepository } from '../repositories';
import {
  QueueEventsMode,
  type QueueEventsRequest,
  type QueueEventsResponse,
} from '../types/events.types';
import { RawEventsFactory } from '../factory/raw-events.factory';

@Injectable()
export class EventEnqueuerService {
  constructor(
    private readonly rawIncomingEventRepository: RawIncomingEventRepository,
    private readonly rawEventsFactory: RawEventsFactory,
  ) {}

  async enqueueBatch(events: QueueEventsRequest): Promise<QueueEventsResponse> {
    const receivedAt = new Date().toISOString();
    const records = await this.rawIncomingEventRepository.createMany(
      this.rawEventsFactory.createRawIncomingEvents(events, receivedAt),
    );

    return {
      mode: QueueEventsMode.AsyncWorker,
      results: this.rawEventsFactory.createQueuedEventResults(records),
      summary: {
        queued: records.length,
      },
    };
  }
}
