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
  private readonly intervalMs = readPositiveNumber(
    process.env.EVENT_ENGINE_WORKER_INTERVAL_MS,
    100,
  );
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(private readonly processing: EventProcessingService) {}

  onModuleInit(): void {
    if (process.env.EVENT_ENGINE_WORKER_DISABLED === 'true') {
      return;
    }

    this.timer = setInterval(() => this.runOnce(), this.intervalMs);
    this.timer.unref?.();
    this.requestRun();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  requestRun(): void {
    if (this.stopped || process.env.EVENT_ENGINE_WORKER_DISABLED === 'true') {
      return;
    }

    setImmediate(() => this.runOnce());
  }

  runOnce(): void {
    if (this.running || this.stopped) {
      return;
    }

    this.running = true;
    try {
      this.processing.processAvailable();
    } catch (error) {
      this.logger.error(
        'Background event worker failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}

function readPositiveNumber(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
