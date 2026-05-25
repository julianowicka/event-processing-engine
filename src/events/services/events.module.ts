import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DatabaseModule } from '../../database/database.module';
import { EventEnqueuerService } from './event-enqueuer.service';
import { EventDecisionWriterService } from './event-processing/event-decision-writer.service';
import { EventMoneyService } from './event-processing/event-money.service';
import { EventProcessingService } from './event-processing/event-processing.service';
import { EventProcessingSchedulerService } from './event-processing-scheduler.service';
import { EventValidationService } from './event-processing/event-validation.service';
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
import { OrderApplicationDecisionService } from './event-processing/order-application-decision.service';
import { OrderCreationApplicationService } from './event-processing/order-creation-application.service';
import { OrderFieldVersionService } from './event-processing/order-field-version.service';
import { OrderLifecycleApplicationService } from './event-processing/order-lifecycle-application.service';
import { OrderPayloadReaderService } from './event-processing/order-payload-reader.service';
import { OrderStateApplicationService } from './event-processing/order-state-application.service';
import { OrderUpdateApplicationService } from './event-processing/order-update-application.service';

@Module({
  imports: [DatabaseModule, DiscoveryModule],
  controllers: [EventsController],
  providers: [
    EventEnqueuerService,
    EventDecisionWriterService,
    EventMoneyService,
    EventProcessingService,
    EventProcessingSchedulerService,
    EventValidationService,
    OrderApplicationDecisionService,
    OrderCreationApplicationService,
    OrderFieldVersionService,
    OrderLifecycleApplicationService,
    OrderPayloadReaderService,
    OrderStateApplicationService,
    OrderUpdateApplicationService,
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
