import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { EventEnqueuerService } from './services/event-enqueuer.service';
import type {
  QueueEventsRequest,
  QueueEventsResponse,
} from './types/events.types';

@Controller('events')
export class EventsController {
  constructor(private readonly eventEnqueuerService: EventEnqueuerService) {}

  @Post()
  create(@Body() events: QueueEventsRequest): Promise<QueueEventsResponse> {
    if (!Array.isArray(events)) {
      throw new BadRequestException('Request body must be an array');
    }

    return this.eventEnqueuerService.enqueueBatch(events);
  }
}
