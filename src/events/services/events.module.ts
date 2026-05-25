import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { EventProcessingService } from './event-processing.service';
import { EventWorkerService } from './event-worker.service';
import { EventsController } from '../events.controller';
import { eventRepositories } from '../repositories';

@Module({
  imports: [DatabaseModule],
  controllers: [EventsController],
  providers: [EventProcessingService, EventWorkerService, ...eventRepositories],
})
export class EventsModule {}
