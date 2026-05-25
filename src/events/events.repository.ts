import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { DatabaseService } from '../database/database.service';
import {
  EventProcessingJobEntity,
  RawIncomingEventEntity,
} from '../database/entities';
import { JobStatus } from './event.types';
import type { EventProjection, QueuedEventRecord } from './events.types';

@Injectable()
export class EventsRepository {
  constructor(
    private readonly databaseService: DatabaseService,
    @InjectRepository(RawIncomingEventEntity)
    private readonly rawEvents: Repository<RawIncomingEventEntity>,
    @InjectRepository(EventProcessingJobEntity)
    private readonly jobs: Repository<EventProcessingJobEntity>,
  ) {}

  enqueueBatch(
    projections: readonly EventProjection[],
  ): Promise<QueuedEventRecord[]> {
    return this.databaseService.transaction((manager) =>
      Promise.all(
        projections.map((projection) =>
          this.enqueueSingle(projection, manager),
        ),
      ),
    );
  }

  private async enqueueSingle(
    projection: EventProjection,
    manager: EntityManager,
  ): Promise<QueuedEventRecord> {
    const now = new Date().toISOString();
    const incomingEvent = await manager
      .getRepository(RawIncomingEventEntity)
      .save(
        this.rawEvents.create({
          eventId: projection.eventId,
          orderId: projection.orderId,
          type: projection.type,
          eventTimestamp: projection.timestamp,
          rawEventJson: projection.rawEventJson,
          payloadJson: projection.payloadJson,
          receivedAt: now,
        }),
      );
    const processingJob = await manager
      .getRepository(EventProcessingJobEntity)
      .save(
        this.jobs.create({
          rawIncomingEventId: incomingEvent.id,
          status: JobStatus.Pending,
          availableAt: now,
          attempts: 0,
          lastErrorMessage: null,
          lastDecisionId: null,
          lastReasonCode: null,
          lockedBy: null,
          lockedAt: null,
          createdAt: now,
          updatedAt: now,
        }),
      );

    return {
      incomingEventId: incomingEvent.id,
      processingJobId: processingJob.id,
      projection,
    };
  }
}
