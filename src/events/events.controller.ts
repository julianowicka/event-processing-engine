import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { JsonValue } from '../common/json.types';
import type { EventDetailsResponse } from './event.types';
import { EventReadService } from './event-read.service';
import { EventsService } from './events.service';
import type { QueueEventsResponse } from './events.types';

@Controller('events')
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly eventReadService: EventReadService,
  ) {}

  @Post()
  enqueue(@Body() body: JsonValue): QueueEventsResponse {
    return this.eventsService.enqueueBatch(body);
  }

  @Get(':eventId')
  getEvent(@Param('eventId') eventId: string): EventDetailsResponse {
    return this.eventReadService.getEventDetails(eventId);
  }
}
