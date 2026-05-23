import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { StateMachineService } from './domain/state-machine.service';
import { EventIngestionService } from './events/event-ingestion.service';
import { EventProcessingService } from './events/event-processing.service';
import { OrdersService } from './orders/orders.service';
import { JsonDatabaseService } from './persistence/json-database.service';
import { StatsService } from './stats/stats.service';

function createHarness(stateMachine = new StateMachineService()) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'event-engine-'));
  process.env.EVENT_ENGINE_DB_FILE = path.join(directory, 'database.json');

  const database = new JsonDatabaseService();
  database.reset();

  const ingestion = new EventIngestionService(database);
  const processing = new EventProcessingService(database, stateMachine);

  return {
    database,
    orders: new OrdersService(database),
    stats: new StatsService(database),
    ingest(batch: unknown[]) {
      return ingestion.ingest(batch);
    },
    runWorker() {
      processing.processAvailable();
    },
    process(batch: unknown[]) {
      const rawDeliveries = ingestion.ingest(batch);
      processing.processAvailable();
      return processing.getResultsForRawIds(
        rawDeliveries.map((item) => item.id),
      );
    },
    cleanup() {
      fs.rmSync(directory, { recursive: true, force: true });
      delete process.env.EVENT_ENGINE_DB_FILE;
    },
  };
}

describe('event engine', () => {
  it('processes queued events while retrying deferred events in the worker phase', () => {
    const harness = createHarness();
    try {
      const results = harness.process([
        {
          eventId: 'evt-payment',
          orderId: 'ord-1',
          type: 'PAYMENT_CAPTURED',
          timestamp: 200,
          payload: { amount: 100 },
        },
        {
          eventId: 'evt-create',
          orderId: 'ord-1',
          type: 'ORDER_CREATED',
          timestamp: 100,
          payload: { amount: 100, currency: 'PLN' },
        },
      ]);

      expect(results.map((item) => item.status)).toEqual([
        'ACCEPTED',
        'ACCEPTED',
      ]);
      expect(harness.orders.getOrder('ord-1').currentState).toMatchObject({
        status: 'PAID',
        amountMinor: 10000,
        paidAmountMinor: 10000,
      });
    } finally {
      harness.cleanup();
    }
  });

  it('deduplicates by eventId and records duplicate stats', () => {
    const harness = createHarness();
    try {
      harness.process([
        {
          eventId: 'evt-create',
          orderId: 'ord-2',
          type: 'ORDER_CREATED',
          timestamp: 100,
          payload: { amount: 50 },
        },
      ]);

      const duplicateResults = harness.process([
        {
          eventId: 'evt-create',
          orderId: 'ord-2',
          type: 'ORDER_CREATED',
          timestamp: 100,
          payload: { amount: 50 },
        },
      ]);

      expect(duplicateResults[0].status).toBe('DUPLICATE');
      expect(harness.stats.getStats()).toMatchObject({
        validEventsCount: 1,
        duplicateEventsCount: 1,
      });
    } finally {
      harness.cleanup();
    }
  });

  it('partially applies late updates field by field', () => {
    const harness = createHarness();
    try {
      harness.process([
        {
          eventId: 'evt-create',
          orderId: 'ord-3',
          type: 'ORDER_CREATED',
          timestamp: 100,
          payload: { amount: 100, currency: 'PLN' },
        },
        {
          eventId: 'evt-update-newer',
          orderId: 'ord-3',
          type: 'ORDER_UPDATED',
          timestamp: 300,
          payload: { amount: 150 },
        },
      ]);

      const results = harness.process([
        {
          eventId: 'evt-update-late',
          orderId: 'ord-3',
          type: 'ORDER_UPDATED',
          timestamp: 200,
          payload: { amount: 200, currency: 'EUR' },
        },
      ]);

      expect(results[0].status).toBe('PARTIALLY_APPLIED');
      expect(harness.orders.getOrder('ord-3').currentState).toMatchObject({
        amountMinor: 15000,
        currency: 'EUR',
      });
    } finally {
      harness.cleanup();
    }
  });

  it('rejects forbidden transitions such as CANCELLED to PAID', () => {
    const harness = createHarness();
    try {
      harness.process([
        {
          eventId: 'evt-create',
          orderId: 'ord-4',
          type: 'ORDER_CREATED',
          timestamp: 100,
          payload: { amount: 80 },
        },
        {
          eventId: 'evt-cancel',
          orderId: 'ord-4',
          type: 'ORDER_CANCELLED',
          timestamp: 200,
          payload: {},
        },
      ]);

      const results = harness.process([
        {
          eventId: 'evt-payment',
          orderId: 'ord-4',
          type: 'PAYMENT_CAPTURED',
          timestamp: 300,
          payload: { amount: 80 },
        },
      ]);

      expect(results[0]).toMatchObject({
        status: 'REJECTED',
        reasonCode: 'FORBIDDEN_TRANSITION',
      });
      expect(harness.orders.getOrder('ord-4').currentState).toMatchObject({
        status: 'CANCELLED',
      });
    } finally {
      harness.cleanup();
    }
  });

  it('moves repeated technical failures to the dead-letter queue', () => {
    const failingStateMachine = {
      canTransition: () => {
        throw new Error('state machine unavailable');
      },
    } as unknown as StateMachineService;
    const harness = createHarness(failingStateMachine);

    try {
      harness.process([
        {
          eventId: 'evt-create',
          orderId: 'ord-dlq',
          type: 'ORDER_CREATED',
          timestamp: 100,
          payload: { amount: 80 },
        },
      ]);

      harness.ingest([
        {
          eventId: 'evt-payment',
          orderId: 'ord-dlq',
          type: 'PAYMENT_CAPTURED',
          timestamp: 200,
          payload: { amount: 80 },
        },
      ]);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const raw = harness.database.read(
          (database) => database.rawIncomingEvents.at(-1)!,
        );
        raw.availableAt = new Date().toISOString();
        harness.database.runInTransaction((database) => {
          database.rawIncomingEvents[database.rawIncomingEvents.length - 1] =
            raw;
        });
        harness.runWorker();
      }

      const database = harness.database.read((state) => state);
      const failedRaw = database.rawIncomingEvents.find(
        (item) => item.eventId === 'evt-payment',
      );

      expect(failedRaw).toMatchObject({
        processingStatus: 'DEAD_LETTERED',
        attempts: 3,
        lastReasonCode: 'PROCESSING_ERROR',
      });
      expect(database.deadLetterEvents).toHaveLength(1);
      expect(harness.stats.getStats()).toMatchObject({
        rejectedEventsCount: 1,
        deadLetterEventsCount: 1,
      });
    } finally {
      harness.cleanup();
    }
  });
});
