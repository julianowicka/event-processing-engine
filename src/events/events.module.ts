import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EventProcessingService } from './event-processing.service';
import { EventReadService } from './event-read.service';
import { EventWorkerService } from './event-worker.service';
import { EventsController } from './events.controller';
import { EventsRepository } from './events.repository';
import { EventsService } from './events.service';
import { EventAuditRepository } from './processing/event-audit.repository';
import { EventDecisionService } from './processing/event-decision.service';
import { EventJobCompletionService } from './processing/event-job-completion.service';
import { EventJobRepository } from './processing/event-job.repository';
import { EventValidationService } from './processing/event-validation.service';
import { OrderRepository } from './processing/order.repository';
import { OrderCancelledEventHandler } from './processing/state-machine/handlers/order-cancelled-event.handler';
import { OrderCreatedEventHandler } from './processing/state-machine/handlers/order-created-event.handler';
import { OrderUpdatedEventHandler } from './processing/state-machine/handlers/order-updated-event.handler';
import { PaymentCapturedEventHandler } from './processing/state-machine/handlers/payment-captured-event.handler';
import { RefundIssuedEventHandler } from './processing/state-machine/handlers/refund-issued-event.handler';
import { OrderEventStateMachineService } from './processing/state-machine/order-event-state-machine.service';
import { OrderStatusTransitionRulesService } from './processing/state-machine/order-status-transition-rules.service';
import { OrderUpdatedEventFieldsService } from './processing/state-machine/order-updated-event-fields.service';

@Module({
  imports: [DatabaseModule],
  controllers: [EventsController],
  providers: [
    EventsService,
    EventsRepository,
    EventReadService,
    EventProcessingService,
    EventWorkerService,
    EventJobRepository,
    EventJobCompletionService,
    OrderRepository,
    EventAuditRepository,
    EventValidationService,
    OrderEventStateMachineService,
    OrderCreatedEventHandler,
    OrderUpdatedEventHandler,
    PaymentCapturedEventHandler,
    OrderCancelledEventHandler,
    RefundIssuedEventHandler,
    OrderStatusTransitionRulesService,
    OrderUpdatedEventFieldsService,
    EventDecisionService,
  ],
})
export class EventsModule {}
