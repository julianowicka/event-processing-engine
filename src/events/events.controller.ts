import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { EventEnqueuerService } from './services/event-enqueuer.service';
import { EventInspectorService } from './services/event-inspector.service';
import type { EventDetailsResponse } from './types/event.types';
import type {
  QueueEventsRequest,
  QueueEventsResponse,
} from './types/events.types';

@Controller('events')
export class EventsController {
  constructor(
    private readonly eventEnqueuerService: EventEnqueuerService,
    private readonly eventInspectorService: EventInspectorService,
  ) {}

  @Post()
  create(@Body() events: QueueEventsRequest): Promise<QueueEventsResponse> {
    if (!Array.isArray(events)) {
      throw new BadRequestException('Request body must be an array');
    }

    return this.eventEnqueuerService.enqueueBatch(events);
  }

  // Test-only diagnostic endpoint used by the bundled frontend.
  @Get(':eventId')
  getById(@Param('eventId') eventId: string): Promise<EventDetailsResponse> {
    return this.eventInspectorService.getEventDetails(eventId);
  }
}
