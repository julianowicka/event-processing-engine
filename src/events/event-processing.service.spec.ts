import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SqliteService } from '../database/sqlite.service';
import { EventProcessingService } from './event-processing.service';
import { EventAuditRepository } from './processing/event-audit.repository';
import { EventDecisionService } from './processing/event-decision.service';
import { EventJobRepository } from './processing/event-job.repository';
import { EventValidationService } from './processing/event-validation.service';
import { OrderEventApplicationService } from './processing/order-event-application.service';
import { OrderMergeService } from './processing/order-merge.service';
import { OrderRepository } from './processing/order.repository';
import { OrderStateMachineService } from './processing/order-state-machine.service';

describe('EventProcessingService payment and refund guards', () => {
  let directory: string;
  let previousDbPath: string | undefined;
  let sqliteService: SqliteService;
  let service: EventProcessingService;

  beforeEach(() => {
    previousDbPath = process.env.SQLITE_DB_PATH;
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'event-processing-'));
    process.env.SQLITE_DB_PATH = path.join(directory, 'database.sqlite');

    sqliteService = new SqliteService();

    const validationService = new EventValidationService();
    const stateMachineService = new OrderStateMachineService();
    const mergeService = new OrderMergeService(
      validationService,
      stateMachineService,
    );
    const decisionService = new EventDecisionService();
    service = new EventProcessingService(
      sqliteService,
      new EventJobRepository(sqliteService),
      new OrderRepository(sqliteService),
      new EventAuditRepository(sqliteService),
      validationService,
      new OrderEventApplicationService(
        validationService,
        stateMachineService,
        mergeService,
        decisionService,
      ),
      decisionService,
    );
  });

  afterEach(() => {
    sqliteService.onModuleDestroy();

    if (previousDbPath === undefined) {
      delete process.env.SQLITE_DB_PATH;
    } else {
      process.env.SQLITE_DB_PATH = previousDbPath;
    }

    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('rejects repeated payment capture and refunds above captured amount', () => {
    enqueue({
      eventId: 'evt-guards-001',
      orderId: 'ord-guards-001',
      type: 'ORDER_CREATED',
      timestamp: 1710001000,
      payload: { amount: 50, currency: 'PLN' },
    });
    enqueue({
      eventId: 'evt-guards-002',
      orderId: 'ord-guards-001',
      type: 'PAYMENT_CAPTURED',
      timestamp: 1710002000,
      payload: { amount: 50 },
    });
    enqueue({
      eventId: 'evt-guards-003',
      orderId: 'ord-guards-001',
      type: 'PAYMENT_CAPTURED',
      timestamp: 1710003000,
      payload: { amount: 50 },
    });
    enqueue({
      eventId: 'evt-guards-004',
      orderId: 'ord-guards-001',
      type: 'REFUND_ISSUED',
      timestamp: 1710004000,
      payload: { refundAmount: 60 },
    });

    while (service.processNextAvailableJob()) {
      // Process the in-memory queue synchronously for this focused test.
    }

    expect(readRejectedReasonCounts()).toEqual([
      expect.objectContaining({
        reason_code: 'PAYMENT_ALREADY_CAPTURED',
        count: 1,
      }),
      expect.objectContaining({
        reason_code: 'REFUND_EXCEEDS_CAPTURED',
        count: 1,
      }),
    ]);
  });

  function enqueue(eventItem: {
    eventId: string;
    orderId: string;
    type: string;
    timestamp: number;
    payload: Record<string, unknown>;
  }): void {
    const now = new Date().toISOString();
    const db = sqliteService.connection;
    const rawResult = db
      .prepare(
        `
          INSERT INTO raw_incoming_events (
            event_id,
            order_id,
            type,
            event_timestamp,
            raw_event_json,
            payload_json,
            received_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        eventItem.eventId,
        eventItem.orderId,
        eventItem.type,
        eventItem.timestamp,
        JSON.stringify(eventItem),
        JSON.stringify(eventItem.payload),
        now,
      );

    db.prepare(
      `
        INSERT INTO event_processing_jobs (
          raw_incoming_event_id,
          status,
          available_at,
          attempts,
          created_at,
          updated_at
        )
        VALUES (?, 'PENDING', ?, 0, ?, ?)
      `,
    ).run(Number(rawResult.lastInsertRowid), now, now, now);
  }

  function readRejectedReasonCounts(): Array<{
    reason_code: string;
    count: number;
  }> {
    return sqliteService.connection
      .prepare(
        `
          SELECT reason_code, COUNT(*) AS count
          FROM event_decisions
          WHERE decision = 'REJECTED'
          GROUP BY reason_code
          ORDER BY reason_code
        `,
      )
      .all() as Array<{ reason_code: string; count: number }>;
  }
});
