import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { EventIngestionService } from './event-ingestion.service';
import { EventWorkerService } from './event-worker.service';

@Controller('events')
export class EventsController {
  constructor(
    private readonly ingestion: EventIngestionService,
    private readonly worker: EventWorkerService,
  ) {}

  @Post()
  postEvents(@Body() body: unknown) {
    if (!Array.isArray(body)) {
      throw new BadRequestException('Request body must be a JSON array');
    }

    const rawDeliveries = this.ingestion.ingest(body);
    this.worker.requestRun();
    const results = rawDeliveries.map((item) => ({
      incomingEventId: item.id,
      eventId: item.eventId,
      orderId: item.orderId,
      type: item.type,
      status: 'QUEUED',
      reasonCode: null,
      reasonMessage: 'Event queued for background processing',
      processingTimeMs: 0,
    }));

    return {
      mode: 'ASYNC_WORKER',
      results,
      summary: {
        queued: results.length,
      },
    };
  }
}
