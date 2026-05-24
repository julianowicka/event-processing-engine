import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EventProcessingService } from './event-processing.service';
import { EventReadService } from './event-read.service';
import { EventWorkerService } from './event-worker.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventAuditRepository } from './processing/event-audit.repository';
import { EventDecisionService } from './processing/event-decision.service';
import { EventJobRepository } from './processing/event-job.repository';
import { EventValidationService } from './processing/event-validation.service';
import { OrderMergeService } from './processing/order-merge.service';
import { OrderRepository } from './processing/order.repository';
import { OrderStateMachineService } from './processing/order-state-machine.service';

@Module({
  imports: [DatabaseModule],
  controllers: [EventsController],
  providers: [
    EventsService,
    EventReadService,
    EventProcessingService,
    EventWorkerService,
    EventJobRepository,
    OrderRepository,
    EventAuditRepository,
    EventValidationService,
    OrderStateMachineService,
    OrderMergeService,
    EventDecisionService,
  ],
})
export class EventsModule {}
