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
import { EventJobRepository } from './processing/event-job.repository';
import { EventValidationService } from './processing/event-validation.service';
import { OrderRepository } from './processing/order.repository';
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
    OrderRepository,
    EventAuditRepository,
    EventValidationService,
    OrderEventStateMachineService,
    OrderStatusTransitionRulesService,
    OrderUpdatedEventFieldsService,
    EventDecisionService,
  ],
})
export class EventsModule {}
