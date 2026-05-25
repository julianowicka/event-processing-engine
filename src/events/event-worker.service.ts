import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { EventProcessingService } from './event-processing.service';
import { verboseLog } from './event-verbose-logger';

const workerIntervalMs = Number(process.env.EVENT_WORKER_INTERVAL_MS ?? 1000);

@Injectable()
export class EventWorkerService implements OnModuleInit {
  private readonly logger = new Logger(EventWorkerService.name);
  private isPolling = false;

  constructor(
    private readonly eventProcessingService: EventProcessingService,
  ) {}

  onModuleInit(): void {
    verboseLog(this.logger, 'worker started', { intervalMs: workerIntervalMs });
  }

  @Interval(workerIntervalMs)
  async poll(): Promise<void> {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;
    try {
      await this.runAvailableWork();
    } finally {
      this.isPolling = false;
    }
  }

  private async runAvailableWork(): Promise<void> {
    let processedJobs = 0;

    while (processedJobs < 500) {
      const outcome =
        await this.eventProcessingService.processNextAvailableJob();

      if (!outcome) {
        break;
      }

      processedJobs += 1;
    }

    if (processedJobs > 0) {
      verboseLog(this.logger, 'worker pass completed', { processedJobs });
    }
  }
}
