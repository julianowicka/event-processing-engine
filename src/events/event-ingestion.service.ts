import { Injectable } from '@nestjs/common';
import { EventEngineDatabase, RawIncomingEventRecord } from '../domain/types';
import {
  isRecord,
  optionalNumber,
  optionalString,
} from '../domain/event-utils';
import { JsonDatabaseService } from '../persistence/json-database.service';

@Injectable()
export class EventIngestionService {
  constructor(private readonly database: JsonDatabaseService) {}

  ingest(batch: unknown[]): RawIncomingEventRecord[] {
    return this.database.runInTransaction((database) =>
      batch.map((item) => this.appendRawDelivery(database, item)),
    );
  }

  private appendRawDelivery(
    database: EventEngineDatabase,
    item: unknown,
  ): RawIncomingEventRecord {
    const record = isRecord(item) ? item : {};
    const now = new Date().toISOString();

    const rawDelivery: RawIncomingEventRecord = {
      id: database.nextIds.rawIncomingEvent++,
      eventId: optionalString(record.eventId),
      orderId: optionalString(record.orderId),
      type: optionalString(record.type),
      eventTimestamp: optionalNumber(record.timestamp),
      rawEvent: item,
      payload: isRecord(record.payload) ? record.payload : null,
      receivedAt: now,
      availableAt: now,
      processingStatus: 'PENDING',
      attempts: 0,
      lastErrorMessage: null,
      lastDecisionId: null,
      lastReasonCode: null,
    };

    database.rawIncomingEvents.push(rawDelivery);
    return rawDelivery;
  }
}
