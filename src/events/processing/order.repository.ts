import { Injectable } from '@nestjs/common';
import type { DatabaseSync as DatabaseSyncInstance } from 'node:sqlite';
import { asSqliteRow } from '../../database/sqlite-row.util';
import { SqliteService } from '../../database/sqlite.service';
import type {
  OrderRow,
  ValidOrderEvent,
  ProcessingJobRow,
} from '../event.types';
import type { NextOrderState } from './event-processing.types';

@Injectable()
export class OrderRepository {
  private readonly db: DatabaseSyncInstance;

  constructor(sqliteService: SqliteService) {
    this.db = sqliteService.connection;
  }

  createOrder(
    event: ValidOrderEvent,
    amountMinor: number | null,
    currency: string | null,
  ): void {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
          INSERT INTO orders (
            order_id,
            status,
            amount_minor,
            currency,
            paid_amount_minor,
            refunded_amount_minor,
            version,
            max_accepted_event_timestamp,
            last_accepted_event_id,
            created_at,
            updated_at
          )
          VALUES (?, 'CREATED', ?, ?, 0, 0, 1, ?, ?, ?, ?)
        `,
      )
      .run(
        event.orderId,
        amountMinor,
        currency,
        event.timestamp,
        event.eventId,
        now,
        now,
      );
  }

  updateOrderState(event: ValidOrderEvent, nextState: NextOrderState): void {
    this.db
      .prepare(
        `
          UPDATE orders
          SET
            status = ?,
            amount_minor = ?,
            currency = ?,
            paid_amount_minor = ?,
            refunded_amount_minor = ?,
            version = version + 1,
            max_accepted_event_timestamp = MAX(max_accepted_event_timestamp, ?),
            last_accepted_event_id = ?,
            updated_at = ?
          WHERE order_id = ?
        `,
      )
      .run(
        nextState.status,
        nextState.amountMinor,
        nextState.currency,
        nextState.paidAmountMinor,
        nextState.refundedAmountMinor,
        event.timestamp,
        event.eventId,
        new Date().toISOString(),
        event.orderId,
      );
  }

  claimDeduplicationKey(
    job: ProcessingJobRow,
    event: ValidOrderEvent,
  ): boolean {
    const existing = this.db
      .prepare(
        `
          SELECT first_raw_incoming_event_id
          FROM processed_event_keys
          WHERE event_id = ?
        `,
      )
      .get(event.eventId) as
      | { first_raw_incoming_event_id: number }
      | undefined;

    if (existing) {
      return existing.first_raw_incoming_event_id === job.raw_incoming_event_id;
    }

    this.db
      .prepare(
        `
          INSERT INTO processed_event_keys (
            event_id,
            first_raw_incoming_event_id,
            order_id,
            first_seen_at
          )
          VALUES (?, ?, ?, ?)
        `,
      )
      .run(
        event.eventId,
        job.raw_incoming_event_id,
        event.orderId,
        new Date().toISOString(),
      );

    return true;
  }

  findOrder(orderId: string): OrderRow | null {
    const row = asSqliteRow<OrderRow>(
      this.db
        .prepare(
          `
          SELECT
            order_id,
            status,
            amount_minor,
            currency,
            paid_amount_minor,
            refunded_amount_minor,
            version,
            max_accepted_event_timestamp,
            last_accepted_event_id,
            created_at,
            updated_at
          FROM orders
          WHERE order_id = ?
        `,
        )
        .get(orderId),
    );

    return row ?? null;
  }

  canApplyField(
    orderId: string,
    fieldName: string,
    event: ValidOrderEvent,
  ): boolean {
    const row = this.db
      .prepare(
        `
          SELECT last_event_timestamp
          FROM order_field_versions
          WHERE order_id = ? AND field_name = ?
        `,
      )
      .get(orderId, fieldName) as { last_event_timestamp: number } | undefined;

    return !row || event.timestamp > row.last_event_timestamp;
  }

  upsertFieldVersion(
    orderId: string,
    fieldName: string,
    event: ValidOrderEvent,
  ): void {
    this.db
      .prepare(
        `
          INSERT INTO order_field_versions (
            order_id,
            field_name,
            last_event_timestamp,
            last_event_id,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(order_id, field_name) DO UPDATE SET
            last_event_timestamp = excluded.last_event_timestamp,
            last_event_id = excluded.last_event_id,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        orderId,
        fieldName,
        event.timestamp,
        event.eventId,
        new Date().toISOString(),
      );
  }
}
