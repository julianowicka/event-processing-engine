import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EventProcessingService } from './event-processing.service';

@Injectable()
export class EventWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventWorkerService.name);
  private readonly verboseLogs =
    process.env.EVENT_WORKER_VERBOSE_LOGS === 'true' ||
    process.env.EVENT_WORKER_VERBOSE_LOGS === '1';
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private rerunRequested = false;

  constructor(
    private readonly eventProcessingService: EventProcessingService,
  ) {}

  onModuleInit(): void {
    if (process.env.EVENT_WORKER_ENABLED === 'false') {
      this.verboseLog('worker disabled', {});
      return;
    }

    const intervalMs = Number(process.env.EVENT_WORKER_INTERVAL_MS ?? 1000);
    this.timer = setInterval(() => this.nudge(), intervalMs);
    this.verboseLog('worker started', { intervalMs });
    this.nudge();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  nudge(): void {
    setTimeout(() => this.runAvailableWork(), 0);
  }

  private runAvailableWork(): void {
    if (this.running) {
      this.rerunRequested = true;
      this.verboseLog('worker rerun requested while busy', {});
      return;
    }

    this.running = true;

    try {
      let processedJobs = 0;
      let outcome = this.eventProcessingService.processNextAvailableJob();

      while (outcome && processedJobs < 500) {
        processedJobs += 1;
        outcome = this.eventProcessingService.processNextAvailableJob();
      }

      if (processedJobs > 0) {
        this.verboseLog('worker pass completed', { processedJobs });
      }
    } finally {
      this.running = false;

      if (this.rerunRequested) {
        this.rerunRequested = false;
        this.nudge();
      }
    }
  }

  private verboseLog(message: string, details: Record<string, unknown>): void {
    if (!this.verboseLogs) {
      return;
    }

    this.logger.log(`${message} ${JSON.stringify(details)}`);
  }
}
