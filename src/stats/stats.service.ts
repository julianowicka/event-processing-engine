import { Injectable } from '@nestjs/common';
import { JsonDatabaseService } from '../persistence/json-database.service';

@Injectable()
export class StatsService {
  constructor(private readonly database: JsonDatabaseService) {}

  getStats() {
    return this.database.read((database) => {
      const processedEventsCount = database.stats.processedEventsCount;
      const pendingEventsCount = database.rawIncomingEvents.filter(
        (item) =>
          item.processingStatus === 'PENDING' ||
          item.processingStatus === 'DEFERRED',
      ).length;

      return {
        validEventsCount: database.stats.validEventsCount,
        rejectedEventsCount: database.stats.rejectedEventsCount,
        duplicateEventsCount: database.stats.duplicateEventsCount,
        averageProcessingTimeMs:
          processedEventsCount === 0
            ? 0
            : database.stats.totalProcessingTimeMs / processedEventsCount,
        acceptedEventsCount: database.stats.acceptedEventsCount,
        partiallyAppliedEventsCount: database.stats.partiallyAppliedEventsCount,
        processedEventsCount,
        pendingEventsCount,
        deadLetterEventsCount: database.deadLetterEvents.length,
      };
    });
  }
}
