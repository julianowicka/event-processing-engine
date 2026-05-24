import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { EventProcessingService } from './event-processing.service';
import { verboseLog } from './event-verbose-logger';

const workerIntervalMs = Number(process.env.EVENT_WORKER_INTERVAL_MS ?? 1000);

@Injectable()
export class EventWorkerService implements OnModuleInit {
  private readonly logger = new Logger(EventWorkerService.name);

  constructor(
    private readonly eventProcessingService: EventProcessingService,
  ) {}

  onModuleInit(): void {
    verboseLog(this.logger, 'worker started', { intervalMs: workerIntervalMs });
  }

  @Interval(workerIntervalMs)
  poll(): void {
    this.runAvailableWork();
  }

  private runAvailableWork(): void {
    let processedJobs = 0;

    while (processedJobs < 500) {
      const outcome = this.eventProcessingService.processNextAvailableJob();

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
