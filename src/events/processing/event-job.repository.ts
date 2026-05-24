import { Injectable, Logger } from '@nestjs/common';
import type { DatabaseSync as DatabaseSyncInstance } from 'node:sqlite';
import { SqliteService } from '../../database/sqlite.service';
import type { ProcessingJobRow, ReasonCode } from '../event.types';

@Injectable()
export class EventJobRepository {
  private readonly logger = new Logger(EventJobRepository.name);
  private readonly db: DatabaseSyncInstance;
  private readonly verboseLogs =
    process.env.EVENT_WORKER_VERBOSE_LOGS === 'true' ||
    process.env.EVENT_WORKER_VERBOSE_LOGS === '1';
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

  constructor(private readonly sqliteService: SqliteService) {
    this.db = sqliteService.connection;
  }

  claimNextAvailableJob(): ProcessingJobRow | null {
    return this.sqliteService.transaction(() => {
      const now = new Date();
      const nowIso = now.toISOString();
      const staleBeforeIso = new Date(
        now.getTime() - this.lockTimeoutMs,
      ).toISOString();
      const claimed = this.db
        .prepare(
          `
            UPDATE event_processing_jobs
            SET
              locked_by = ?,
              locked_at = ?,
              updated_at = ?
            WHERE id = (
              SELECT jobs.id
              FROM event_processing_jobs jobs
              JOIN raw_incoming_events raw ON raw.id = jobs.raw_incoming_event_id
              WHERE jobs.status IN ('PENDING', 'DEFERRED')
                AND jobs.available_at <= ?
                AND (
                  jobs.locked_by IS NULL
                  OR jobs.locked_at IS NULL
                  OR jobs.locked_at <= ?
                )
              ORDER BY raw.id ASC
              LIMIT 1
            )
            RETURNING id
          `,
        )
        .get(this.workerId, nowIso, nowIso, nowIso, staleBeforeIso) as
        | { id: number }
        | undefined;

      if (!claimed) {
        return null;
      }

      const job = this.db
        .prepare(
          `
            SELECT
              jobs.id AS job_id,
              jobs.raw_incoming_event_id,
              jobs.status,
              jobs.attempts,
              jobs.locked_by,
              jobs.locked_at,
              raw.raw_event_json,
              raw.event_id,
              raw.order_id,
              raw.type,
              raw.event_timestamp
            FROM event_processing_jobs jobs
            JOIN raw_incoming_events raw ON raw.id = jobs.raw_incoming_event_id
            WHERE jobs.id = ?
          `,
        )
        .get(claimed.id) as unknown as ProcessingJobRow;

      this.verboseLog('claimed job', {
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

  markFinalDecision(
    job: ProcessingJobRow,
    decisionId: number,
    reasonCode: ReasonCode,
  ): void {
    this.db
      .prepare(
        `
          UPDATE event_processing_jobs
          SET
            status = 'DONE',
            last_decision_id = ?,
            last_reason_code = ?,
            locked_by = NULL,
            locked_at = NULL,
            updated_at = ?
          WHERE id = ?
            AND locked_by = ?
        `,
      )
      .run(
        decisionId,
        reasonCode,
        new Date().toISOString(),
        job.job_id,
        this.workerId,
      );
  }

  markDeferred(job: ProcessingJobRow, decisionId: number): void {
    const now = new Date();
    const availableAt = new Date(
      now.getTime() + this.deferredRetryMs,
    ).toISOString();

    this.db
      .prepare(
        `
          UPDATE event_processing_jobs
          SET
            status = 'DEFERRED',
            available_at = ?,
            last_decision_id = ?,
            last_reason_code = 'ORDER_NOT_READY',
            locked_by = NULL,
            locked_at = NULL,
            updated_at = ?
          WHERE id = ?
            AND locked_by = ?
        `,
      )
      .run(
        availableAt,
        decisionId,
        now.toISOString(),
        job.job_id,
        this.workerId,
      );
  }

  hasPendingPaymentForOrder(orderId: string, refundTimestamp: number): boolean {
    const row = this.db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM event_processing_jobs jobs
          JOIN raw_incoming_events raw ON raw.id = jobs.raw_incoming_event_id
          WHERE raw.order_id = ?
            AND raw.type = 'PAYMENT_CAPTURED'
            AND raw.event_timestamp <= ?
            AND jobs.status IN ('PENDING', 'DEFERRED')
        `,
      )
      .get(orderId, refundTimestamp) as { count: number };

    return row.count > 0;
  }

  releaseDeferredJobsForOrder(orderId: string): void {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
          UPDATE event_processing_jobs
          SET available_at = ?, updated_at = ?
          WHERE status = 'DEFERRED'
            AND locked_by IS NULL
            AND raw_incoming_event_id IN (
              SELECT id
              FROM raw_incoming_events
              WHERE order_id = ?
            )
        `,
      )
      .run(now, now, orderId);
  }

  scheduleTechnicalRetry(
    job: ProcessingJobRow,
    attempts: number,
    errorMessage: string,
  ): void {
    const now = new Date();

    this.db
      .prepare(
        `
          UPDATE event_processing_jobs
          SET
            status = 'PENDING',
            attempts = ?,
            available_at = ?,
            last_error_message = ?,
            locked_by = NULL,
            locked_at = NULL,
            updated_at = ?
          WHERE id = ?
            AND locked_by = ?
        `,
      )
      .run(
        attempts,
        new Date(now.getTime() + this.retryDelayMs).toISOString(),
        errorMessage,
        now.toISOString(),
        job.job_id,
        this.workerId,
      );

    this.verboseLog('technical retry scheduled', {
      jobId: job.job_id,
      rawIncomingEventId: job.raw_incoming_event_id,
      attempts,
      errorMessage,
    });
  }

  markDeadLettered(
    job: ProcessingJobRow,
    attempts: number,
    errorMessage: string,
    decisionId: number,
  ): void {
    this.db
      .prepare(
        `
          UPDATE event_processing_jobs
          SET
            status = 'DEAD_LETTERED',
            attempts = ?,
            last_error_message = ?,
            last_decision_id = ?,
            last_reason_code = 'PROCESSING_ERROR',
            locked_by = NULL,
            locked_at = NULL,
            updated_at = ?
          WHERE id = ?
            AND locked_by = ?
        `,
      )
      .run(
        attempts,
        errorMessage,
        decisionId,
        new Date().toISOString(),
        job.job_id,
        this.workerId,
      );
  }

  private verboseLog(message: string, details: Record<string, unknown>): void {
    if (!this.verboseLogs) {
      return;
    }

    this.logger.log(`${message} ${JSON.stringify(details)}`);
  }
}
