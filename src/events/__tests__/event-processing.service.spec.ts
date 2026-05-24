import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { JsonObject } from '../../common/json.types';
import { SqliteService } from '../../database/sqlite.service';
import { EventProcessingService } from '../event-processing.service';
import {
  EngineDecision,
  JobStatus,
  ReasonCode,
  SupportedEventType,
} from '../event.types';
import { EventAuditRepository } from '../processing/event-audit.repository';
import { EventDecisionService } from '../processing/event-decision.service';
import { EventJobCompletionService } from '../processing/event-job-completion.service';
import { EventJobRepository } from '../processing/event-job.repository';
import { EventValidationService } from '../processing/event-validation.service';
import { OrderRepository } from '../processing/order.repository';
import { OrderCancelledEventHandler } from '../processing/state-machine/handlers/order-cancelled-event.handler';
import { OrderCreatedEventHandler } from '../processing/state-machine/handlers/order-created-event.handler';
import { OrderUpdatedEventHandler } from '../processing/state-machine/handlers/order-updated-event.handler';
import { PaymentCapturedEventHandler } from '../processing/state-machine/handlers/payment-captured-event.handler';
import { RefundIssuedEventHandler } from '../processing/state-machine/handlers/refund-issued-event.handler';
import { OrderEventStateMachineService } from '../processing/state-machine/order-event-state-machine.service';
import { OrderStatusTransitionRulesService } from '../processing/state-machine/order-status-transition-rules.service';
import { OrderUpdatedEventFieldsService } from '../processing/state-machine/order-updated-event-fields.service';

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
    const statusTransitionRules = new OrderStatusTransitionRulesService();
    const orderUpdatedEventFields = new OrderUpdatedEventFieldsService(
      validationService,
      statusTransitionRules,
    );
    const decisionService = new EventDecisionService();
    const jobRepository = new EventJobRepository(sqliteService);
    const orderRepository = new OrderRepository(sqliteService);
    const auditRepository = new EventAuditRepository(sqliteService);
    service = new EventProcessingService(
      sqliteService,
      jobRepository,
      orderRepository,
      validationService,
      new OrderEventStateMachineService(
        new OrderCreatedEventHandler(validationService, decisionService),
        new OrderUpdatedEventHandler(orderUpdatedEventFields, decisionService),
        new PaymentCapturedEventHandler(
          validationService,
          statusTransitionRules,
          decisionService,
        ),
        new OrderCancelledEventHandler(statusTransitionRules, decisionService),
        new RefundIssuedEventHandler(
          validationService,
          statusTransitionRules,
          decisionService,
        ),
      ),
      decisionService,
      new EventJobCompletionService(
        sqliteService,
        jobRepository,
        orderRepository,
        auditRepository,
        validationService,
        decisionService,
      ),
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
      type: SupportedEventType.OrderCreated,
      timestamp: 1710001000,
      payload: { amount: 50, currency: 'PLN' },
    });
    enqueue({
      eventId: 'evt-guards-002',
      orderId: 'ord-guards-001',
      type: SupportedEventType.PaymentCaptured,
      timestamp: 1710002000,
      payload: { amount: 50 },
    });
    enqueue({
      eventId: 'evt-guards-003',
      orderId: 'ord-guards-001',
      type: SupportedEventType.PaymentCaptured,
      timestamp: 1710003000,
      payload: { amount: 50 },
    });
    enqueue({
      eventId: 'evt-guards-004',
      orderId: 'ord-guards-001',
      type: SupportedEventType.RefundIssued,
      timestamp: 1710004000,
      payload: { refundAmount: 60 },
    });

    while (service.processNextAvailableJob()) {
      // Process the in-memory queue synchronously for this focused test.
    }

    expect(readRejectedReasonCounts()).toEqual([
      expect.objectContaining({
        reason_code: ReasonCode.PaymentAlreadyCaptured,
        count: 1,
      }),
      expect.objectContaining({
        reason_code: ReasonCode.RefundExceedsCaptured,
        count: 1,
      }),
    ]);
  });

  function enqueue(eventItem: {
    eventId: string;
    orderId: string;
    type: SupportedEventType;
    timestamp: number;
    payload: JsonObject;
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
        VALUES (?, ?, ?, 0, ?, ?)
      `,
    ).run(Number(rawResult.lastInsertRowid), JobStatus.Pending, now, now, now);
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
          WHERE decision = ?
          GROUP BY reason_code
          ORDER BY reason_code
        `,
      )
      .all(EngineDecision.Rejected) as Array<{
      reason_code: string;
      count: number;
    }>;
  }
});
