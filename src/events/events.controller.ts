import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { EventDetailsResponse, QueueEventsResponse } from './event.types';
import { EventReadService } from './event-read.service';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly eventReadService: EventReadService,
  ) {}

  @Post()
  enqueue(@Body() body: unknown): QueueEventsResponse {
    return this.eventsService.enqueueBatch(body);
  }

  @Get(':eventId')
  getEvent(@Param('eventId') eventId: string): EventDetailsResponse {
    return this.eventReadService.getEventDetails(eventId);
  }
}
