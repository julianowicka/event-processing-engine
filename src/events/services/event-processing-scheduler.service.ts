import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { RawIncomingEventEntity } from '../../database/entities';
import { RawIncomingEventRepository } from '../repositories';
import { ProcessingStatus } from '../types/event.types';
import { EventProcessingService } from './event-processing/event-processing.service';

const DEFAULT_EVENT_PROCESSING_SCHEDULER_INTERVAL_MS = 100;

const configuredSchedulerIntervalMs = Number(
  process.env.EVENT_PROCESSING_SCHEDULER_INTERVAL_MS,
);
const eventProcessingSchedulerIntervalMs =
  Number.isInteger(configuredSchedulerIntervalMs) &&
  configuredSchedulerIntervalMs > 0
    ? configuredSchedulerIntervalMs
    : DEFAULT_EVENT_PROCESSING_SCHEDULER_INTERVAL_MS;

@Injectable()
export class EventProcessingSchedulerService implements OnModuleInit {
  private isPolling = false;

  constructor(
    private readonly rawIncomingEventRepository: RawIncomingEventRepository,
    @Optional()
    private readonly eventProcessingService?: EventProcessingService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.pollPendingOrRetryEvents();
  }

  @Interval(eventProcessingSchedulerIntervalMs)
  async handlePollingInterval(): Promise<void> {
    await this.pollPendingOrRetryEvents();
  }

  async pollPendingOrRetryEvents(): Promise<RawIncomingEventEntity[]> {
    if (this.isPolling) {
      return [];
    }

    this.isPolling = true;

    try {
      const events = await this.rawIncomingEventRepository.find({
        where: [
          { processingStatus: ProcessingStatus.Pending },
          { processingStatus: ProcessingStatus.Retry },
        ],
        order: {
          eventTimestamp: { direction: 'ASC', nulls: 'LAST' },
          id: 'ASC',
        },
      });
      const availableEvents = await this.filterAvailableEvents(events);

      await this.processEvents(availableEvents);

      return availableEvents;
    } finally {
      this.isPolling = false;
    }
  }

  private async filterAvailableEvents(
    events: RawIncomingEventEntity[],
  ): Promise<RawIncomingEventEntity[]> {
    await Promise.resolve();

    const now = Date.now();

    return events.filter((event) => Date.parse(event.availableAt) <= now);
  }

  private async processEvents(events: RawIncomingEventEntity[]): Promise<void> {
    if (!this.eventProcessingService) {
      return;
    }

    for (const event of events) {
      await this.eventProcessingService.processEvent(event);
    }
  }
}
