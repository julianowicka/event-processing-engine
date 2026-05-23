import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { StateMachineService } from './domain/state-machine.service';
import { EventIngestionService } from './events/event-ingestion.service';
import { EventProcessingService } from './events/event-processing.service';
import { EventWorkerService } from './events/event-worker.service';
import { EventsController } from './events/events.controller';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { JsonDatabaseService } from './persistence/json-database.service';
import { StatsController } from './stats/stats.controller';
import { StatsService } from './stats/stats.service';

@Module({
  imports: [],
  controllers: [
    AppController,
    EventsController,
    OrdersController,
    StatsController,
  ],
  providers: [
    JsonDatabaseService,
    EventIngestionService,
    EventProcessingService,
    EventWorkerService,
    OrdersService,
    StatsService,
    StateMachineService,
  ],
})
export class AppModule {}
