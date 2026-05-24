import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';
import { OrdersModule } from './orders/orders.module';
import { StatsModule } from './stats/stats.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    DatabaseModule,
    EventsModule,
    OrdersModule,
    StatsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
