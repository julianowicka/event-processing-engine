import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, In, IsNull } from 'typeorm';
import { DatabaseService } from '../../database/database.service';
import {
  EventProcessingJobEntity,
  RawIncomingEventEntity,
} from '../../database/entities';
import { verboseLog } from '../event-verbose-logger';
import { JobStatus, ReasonCode, SupportedEventType } from '../event.types';
import type { ProcessingJobRow } from '../event.types';

@Injectable()
export class EventJobRepository {
  private readonly logger = new Logger(EventJobRepository.name);
  private readonly deferredRetryMs = 60_000;
  private readonly retryDelayMs = 3_000;
  private readonly lockTimeoutMs = Number(
    process.env.EVENT_WORKER_LOCK_TIMEOUT_MS ?? 30_000,
  );
  readonly workerId = [
    'worker',
    process.pid,
    Date.now(),
    Math.random().toString(36).slice(2),
  ].join('-');

  constructor(private readonly databaseService: DatabaseService) {}

  claimNextAvailableJob(): Promise<ProcessingJobRow | null> {
    return this.databaseService.transaction(async (manager) => {
      const repository = manager.getRepository(EventProcessingJobEntity);
      const now = new Date();
      const nowIso = now.toISOString();
      const staleBeforeIso = new Date(
        now.getTime() - this.lockTimeoutMs,
      ).toISOString();
      const candidate = await repository
        .createQueryBuilder('job')
        .where('job.status IN (:...statuses)', {
          statuses: [JobStatus.Pending, JobStatus.Deferred],
        })
        .andWhere('job.availableAt <= :now', { now: nowIso })
        .andWhere(
          '(job.lockedBy IS NULL OR job.lockedAt IS NULL OR job.lockedAt <= :staleBefore)',
          { staleBefore: staleBeforeIso },
        )
        .orderBy('job.rawIncomingEventId', 'ASC')
        .getOne();

      if (!candidate) {
        return null;
      }

      const claimed = await repository
        .createQueryBuilder()
        .update()
        .set({
          lockedBy: this.workerId,
          lockedAt: nowIso,
          updatedAt: nowIso,
        })
        .where('id = :id', { id: candidate.id })
        .andWhere(
          '(lockedBy IS NULL OR lockedAt IS NULL OR lockedAt <= :staleBefore)',
          { staleBefore: staleBeforeIso },
        )
        .execute();

      if (claimed.affected !== 1) {
        return null;
      }

      const rawEvent = await manager
        .getRepository(RawIncomingEventEntity)
        .findOneByOrFail({ id: candidate.rawIncomingEventId });
      const job = this.toProcessingJobRow(
        { ...candidate, lockedBy: this.workerId, lockedAt: nowIso },
        rawEvent,
      );

      verboseLog(this.logger, 'claimed job', {
        jobId: job.job_id,
        rawIncomingEventId: job.raw_incoming_event_id,
        eventId: job.event_id,
        orderId: job.order_id,
        type: job.type,
        status: job.status,
        workerId: this.workerId,
      });

      return job;
    });
  }

  async markFinalDecision(
    job: ProcessingJobRow,
    decisionId: number,
    reasonCode: ReasonCode,
    manager: EntityManager,
  ): Promise<void> {
    await manager.getRepository(EventProcessingJobEntity).update(
      { id: job.job_id, lockedBy: this.workerId },
      {
        status: JobStatus.Done,
        lastDecisionId: decisionId,
        lastReasonCode: reasonCode,
        lockedBy: null,
        lockedAt: null,
        updatedAt: new Date().toISOString(),
      },
    );
  }

  async markDeferred(
    job: ProcessingJobRow,
    decisionId: number,
    manager: EntityManager,
  ): Promise<void> {
    const now = new Date();

    await manager.getRepository(EventProcessingJobEntity).update(
      { id: job.job_id, lockedBy: this.workerId },
      {
        status: JobStatus.Deferred,
        availableAt: new Date(
          now.getTime() + this.deferredRetryMs,
        ).toISOString(),
        lastDecisionId: decisionId,
        lastReasonCode: ReasonCode.OrderNotReady,
        lockedBy: null,
        lockedAt: null,
        updatedAt: now.toISOString(),
      },
    );
  }

  async hasPendingPaymentForOrder(
    orderId: string,
    refundTimestamp: number,
    manager: EntityManager,
  ): Promise<boolean> {
    const count = await manager
      .getRepository(EventProcessingJobEntity)
      .createQueryBuilder('job')
      .innerJoin(
        RawIncomingEventEntity,
        'raw',
        'raw.id = job.rawIncomingEventId',
      )
      .where('raw.orderId = :orderId', { orderId })
      .andWhere('raw.type = :type', {
        type: SupportedEventType.PaymentCaptured,
      })
      .andWhere('raw.eventTimestamp <= :refundTimestamp', { refundTimestamp })
      .andWhere('job.status IN (:...statuses)', {
        statuses: [JobStatus.Pending, JobStatus.Deferred],
      })
      .getCount();

    return count > 0;
  }

  async releaseDeferredJobsForOrder(
    orderId: string,
    manager: EntityManager,
  ): Promise<void> {
    const eventIds = (
      await manager.getRepository(RawIncomingEventEntity).find({
        select: { id: true },
        where: { orderId },
      })
    ).map((event) => event.id);

    if (eventIds.length === 0) {
      return;
    }

    const now = new Date().toISOString();
    await manager.getRepository(EventProcessingJobEntity).update(
      {
        status: JobStatus.Deferred,
        lockedBy: IsNull(),
        rawIncomingEventId: In(eventIds),
      },
      { availableAt: now, updatedAt: now },
    );
  }

  async scheduleTechnicalRetry(
    job: ProcessingJobRow,
    attempts: number,
    errorMessage: string,
    manager: EntityManager,
  ): Promise<void> {
    const now = new Date();

    await manager.getRepository(EventProcessingJobEntity).update(
      { id: job.job_id, lockedBy: this.workerId },
      {
        status: JobStatus.Pending,
        attempts,
        availableAt: new Date(now.getTime() + this.retryDelayMs).toISOString(),
        lastErrorMessage: errorMessage,
        lockedBy: null,
        lockedAt: null,
        updatedAt: now.toISOString(),
      },
    );

    verboseLog(this.logger, 'technical retry scheduled', {
      jobId: job.job_id,
      rawIncomingEventId: job.raw_incoming_event_id,
      attempts,
      errorMessage,
    });
  }

  async markDeadLettered(
    job: ProcessingJobRow,
    attempts: number,
    errorMessage: string,
    decisionId: number,
    manager: EntityManager,
  ): Promise<void> {
    await manager.getRepository(EventProcessingJobEntity).update(
      { id: job.job_id, lockedBy: this.workerId },
      {
        status: JobStatus.DeadLettered,
        attempts,
        lastErrorMessage: errorMessage,
        lastDecisionId: decisionId,
        lastReasonCode: ReasonCode.ProcessingError,
        lockedBy: null,
        lockedAt: null,
        updatedAt: new Date().toISOString(),
      },
    );
  }

  private toProcessingJobRow(
    job: EventProcessingJobEntity,
    raw: RawIncomingEventEntity,
  ): ProcessingJobRow {
    return {
      job_id: job.id,
      raw_incoming_event_id: job.rawIncomingEventId,
      status: job.status,
      attempts: job.attempts,
      locked_by: job.lockedBy,
      locked_at: job.lockedAt,
      raw_event_json: raw.rawEventJson,
      event_id: raw.eventId,
      order_id: raw.orderId,
      type: raw.type,
      event_timestamp: raw.eventTimestamp,
    };
  }
}
