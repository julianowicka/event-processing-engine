import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EventProcessingService } from './event-processing.service';
import { EventReadService } from './event-read.service';
import { EventWorkerService } from './event-worker.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [DatabaseModule],
  controllers: [EventsController],
  providers: [
    EventsService,
    EventReadService,
    EventProcessingService,
    EventWorkerService,
  ],
})
export class EventsModule {}
