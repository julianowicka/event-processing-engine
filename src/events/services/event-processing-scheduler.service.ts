import { Injectable, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { RawIncomingEventEntity } from '../../database/entities';
import { RawIncomingEventRepository } from '../repositories';
import { ProcessingStatus } from '../types/event.types';

const DEFAULT_EVENT_PROCESSING_SCHEDULER_INTERVAL_MS = 100;

const eventProcessingSchedulerIntervalMs =
  getEventProcessingSchedulerIntervalMs(
    process.env.EVENT_PROCESSING_SCHEDULER_INTERVAL_MS,
  );

@Injectable()
export class EventProcessingSchedulerService implements OnModuleInit {
  private isPolling = false;

  constructor(
    private readonly rawIncomingEventRepository: RawIncomingEventRepository,
  ) {}

  onModuleInit(): void {
    void this.pollPendingOrRetryEvents();
  }

  @Interval(eventProcessingSchedulerIntervalMs)
  handlePollingInterval(): void {
    void this.pollPendingOrRetryEvents();
  }

  async pollPendingOrRetryEvents(): Promise<RawIncomingEventEntity[]> {
    if (this.isPolling) {
      return [];
    }

    this.isPolling = true;

    try {
      return await this.rawIncomingEventRepository.findBy([
        { processingStatus: ProcessingStatus.Pending },
        { processingStatus: ProcessingStatus.Retry },
      ]);
    } finally {
      this.isPolling = false;
    }
  }
}

function getEventProcessingSchedulerIntervalMs(
  value: string | undefined,
): number {
  const parsedValue = Number(value);

  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : DEFAULT_EVENT_PROCESSING_SCHEDULER_INTERVAL_MS;
}
