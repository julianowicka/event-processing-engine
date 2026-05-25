import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DatabaseModule } from '../../database/database.module';
import { EventEnqueuerService } from './event-enqueuer.service';
import { EventProcessingService } from './event-processing/event-processing.service';
import { EventProcessingSchedulerService } from './event-processing-scheduler.service';
import { EventsController } from '../events.controller';
import { eventRepositories } from '../repositories';
import { RawEventsFactory } from '../factory/raw-events.factory';
import { NonExistentOrderEventHandler } from './event-processing/handlers/non-existent-order-event.handler';
import { OrderCancelledEventHandler } from './event-processing/handlers/order-cancelled-event.handler';
import { OrderCreatedEventHandler } from './event-processing/handlers/order-created-event.handler';
import { OrderEventHandlerFactory } from './event-processing/handlers/order-event-handler.factory';
import { OrderPaidEventHandler } from './event-processing/handlers/order-paid-event.handler';
import { OrderPartiallyRefundedEventHandler } from './event-processing/handlers/order-partially-refunded-event.handler';
import { OrderRefundedEventHandler } from './event-processing/handlers/order-refunded-event.handler';

@Module({
  imports: [DatabaseModule, DiscoveryModule],
  controllers: [EventsController],
  providers: [
    EventEnqueuerService,
    EventProcessingService,
    EventProcessingSchedulerService,
    RawEventsFactory,
    OrderEventHandlerFactory,
    NonExistentOrderEventHandler,
    OrderCreatedEventHandler,
    OrderPaidEventHandler,
    OrderCancelledEventHandler,
    OrderPartiallyRefundedEventHandler,
    OrderRefundedEventHandler,
    ...eventRepositories,
  ],
})
export class EventsModule {}
