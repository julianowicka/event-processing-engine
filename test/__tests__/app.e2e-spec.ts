import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import {
  EventDecisionEntity,
  OrderEntity,
  RawIncomingEventEntity,
} from '../../src/database/entities';
import {
  EngineDecision,
  ProcessingStatus,
  type EventDetailsResponse,
} from '../../src/events/types/event.types';
import type { QueueEventsResponse } from '../../src/events/types/events.types';
import type { OrderDetailsResponse } from '../../src/orders/orders.types';

describe('Event ingestion API (e2e)', () => {
  let app: INestApplication<App>;
  let directory: string;

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'events-api-e2e-'));
    process.env.SQLITE_DB_PATH = path.join(directory, 'database.sqlite');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  it('queues every event item in a hostile batch', async () => {
    const hostileBatch = [
      {
        eventId: 'evt-hard-002',
        orderId: 'ord-hard-501',
        type: 'PAYMENT_CAPTURED',
        timestamp: 1710001200,
        payload: { amount: 199.99 },
      },
      {
        eventId: 'evt-hard-001',
        orderId: 'ord-hard-501',
        type: 'ORDER_CREATED',
        timestamp: 1710001100,
        payload: { amount: 199.99, currency: 'PLN' },
      },
      {
        eventId: 'evt-hard-002',
        orderId: 'ord-hard-501',
        type: 'PAYMENT_CAPTURED',
        timestamp: 1710001200,
        payload: { amount: 199.99 },
      },
      {
        eventId: 'evt-hard-003',
        orderId: 'ord-hard-501',
        type: 'ORDER_UPDATED',
        timestamp: 1710001000,
        payload: { amount: 149.99, currency: 'EUR' },
      },
      {
        eventId: 'evt-hard-004',
        orderId: 'ord-hard-501',
        type: 'ORDER_UPDATED',
        timestamp: 1710001300,
        payload: { status: 'CANCELLED', amount: 249.99 },
      },
      {
        eventId: '',
        orderId: 'ord-hard-501',
        type: 'REFUND_ISSUED',
        timestamp: 1710001400,
        payload: { refundAmount: -30 },
      },
      {
        orderId: 'ord-hard-501',
        type: 'ALIEN_SIGNAL',
        timestamp: 'not-a-number',
        payload: null,
      },
      'not even an object',
      null,
    ];

    await request(app.getHttpServer())
      .post('/api/events')
      .send(hostileBatch)
      .expect(201)
      .expect((response) => {
        const body = response.body as QueueEventsResponse;

        expect(body).toMatchObject({
          mode: 'ASYNC_WORKER',
          summary: { queued: hostileBatch.length },
        });
        expect(body.results).toHaveLength(hostileBatch.length);
        expect(body.results[0]).toMatchObject({
          incomingEventId: 1,
          eventId: 'evt-hard-002',
          orderId: 'ord-hard-501',
          type: 'PAYMENT_CAPTURED',
          status: 'QUEUED',
          processingTimeMs: 0,
        });
        expect(body.results[5]).toMatchObject({
          eventId: '',
          type: 'REFUND_ISSUED',
        });
        expect(body.results[7]).toMatchObject({
          eventId: null,
          orderId: null,
          type: null,
        });
      });

    const stats = await waitForStats({
      finalizedEventsCount: hostileBatch.length - 1,
    });

    expect(stats).toMatchObject({
      validEventsCount: 3,
      duplicateEventsCount: 1,
      rejectedEventsCount: 4,
    });

    expect(await readOrder('ord-hard-501')).toMatchObject({
      status: 'PAID',
      amount_minor: 24999,
      paid_amount_minor: 19999,
      refunded_amount_minor: 0,
    });

    expect(await readDecisionCounts()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decision: 'ACCEPTED',
          reason_code: 'APPLIED',
          count: 2,
        }),
        expect.objectContaining({
          decision: 'PARTIALLY_APPLIED',
          reason_code: 'PARTIAL_MERGE',
          count: 1,
        }),
        expect.objectContaining({
          decision: 'DUPLICATE',
          reason_code: 'DUPLICATE_EVENT',
          count: 1,
        }),
      ]),
    );
  });

  it('rejects a non-array request body', async () => {
    await request(app.getHttpServer())
      .post('/api/events')
      .send({ eventId: 'evt-not-a-batch' })
      .expect(400);
  });

  it('processes an out-of-order batch from the lowest timestamp first', async () => {
    const outOfOrderBatch = [
      {
        eventId: 'evt-recover-003',
        orderId: 'ord-recover-001',
        type: 'REFUND_ISSUED',
        timestamp: 1710003000,
        payload: { refundAmount: 30 },
      },
      {
        eventId: 'evt-recover-002',
        orderId: 'ord-recover-001',
        type: 'PAYMENT_CAPTURED',
        timestamp: 1710002000,
        payload: { amount: 120 },
      },
      {
        eventId: 'evt-recover-001',
        orderId: 'ord-recover-001',
        type: 'ORDER_CREATED',
        timestamp: 1710001000,
        payload: { amount: 120, currency: 'PLN' },
      },
    ];

    await request(app.getHttpServer())
      .post('/api/events')
      .send(outOfOrderBatch)
      .expect(201)
      .expect((response) => {
        const body = response.body as QueueEventsResponse;

        expect(body.summary).toMatchObject({ queued: 3 });
      });

    const stats = await waitForStats({ finalizedEventsCount: 3 });

    expect(stats).toMatchObject({
      validEventsCount: 3,
      rejectedEventsCount: 0,
      duplicateEventsCount: 0,
    });

    const order = await waitForOrder('ord-recover-001');

    expect(order.currentState).toMatchObject({
      status: 'PARTIALLY_REFUNDED',
      paidAmountMinor: 12000,
      refundedAmountMinor: 3000,
    });
    expect(order.pendingJobs).toEqual([]);

    expect(await readDecisionCounts()).toEqual([
      expect.objectContaining({
        decision: 'ACCEPTED',
        reason_code: 'APPLIED',
        count: 3,
      }),
    ]);
  });

  it('keeps valid stress and forbidden transition scenarios isolated', async () => {
    const stressOrderId = 'ord-ui-stress-001';
    const forbiddenOrderId = 'ord-ui-state-001';
    const stressBatch = [
      {
        eventId: 'evt-ui-stress-001',
        orderId: stressOrderId,
        type: 'ORDER_CREATED',
        timestamp: 1710001000,
        payload: { amount: 120, currency: 'PLN' },
      },
      {
        eventId: 'evt-ui-stress-002',
        orderId: stressOrderId,
        type: 'PAYMENT_CAPTURED',
        timestamp: 1710002000,
        payload: { amount: 120 },
      },
      {
        eventId: 'evt-ui-stress-003',
        orderId: stressOrderId,
        type: 'ORDER_UPDATED',
        timestamp: 1710003000,
        payload: { amount: 130 },
      },
      {
        eventId: 'evt-ui-stress-004',
        orderId: stressOrderId,
        type: 'ORDER_UPDATED',
        timestamp: 1710002500,
        payload: { amount: 125, currency: 'EUR' },
      },
      {
        eventId: 'evt-ui-stress-005',
        orderId: stressOrderId,
        type: 'REFUND_ISSUED',
        timestamp: 1710004000,
        payload: { refundAmount: 30 },
      },
      {
        eventId: 'evt-ui-stress-003',
        orderId: stressOrderId,
        type: 'ORDER_UPDATED',
        timestamp: 1710003000,
        payload: { amount: 130 },
      },
    ];
    const forbiddenBatch = [
      {
        eventId: 'evt-ui-state-001',
        orderId: forbiddenOrderId,
        type: 'ORDER_CREATED',
        timestamp: 1710004000,
        payload: { amount: 80, currency: 'PLN' },
      },
      {
        eventId: 'evt-ui-state-002',
        orderId: forbiddenOrderId,
        type: 'ORDER_CANCELLED',
        timestamp: 1710004100,
        payload: {},
      },
      {
        eventId: 'evt-ui-state-003',
        orderId: forbiddenOrderId,
        type: 'PAYMENT_CAPTURED',
        timestamp: 1710004200,
        payload: { amount: 80 },
      },
      {
        eventId: 'evt-ui-state-004',
        orderId: forbiddenOrderId,
        type: 'REFUND_ISSUED',
        timestamp: 1710004300,
        payload: { refundAmount: 80 },
      },
    ];

    await request(app.getHttpServer())
      .post('/api/events')
      .send(stressBatch)
      .expect(201)
      .expect((response) => {
        const body = response.body as QueueEventsResponse;

        expect(body.summary).toMatchObject({ queued: 6 });
      });

    await waitForStats({ finalizedEventsCount: 6 });

    const statsAfterStress = await request(app.getHttpServer())
      .get('/api/stats')
      .expect(200)
      .then((response) => response.body as Record<string, number>);

    expect(Object.keys(statsAfterStress).sort()).toEqual([
      'averageProcessingTimeMs',
      'duplicateEventsCount',
      'rejectedEventsCount',
      'validEventsCount',
    ]);
    expect(statsAfterStress).toMatchObject({
      validEventsCount: 5,
      duplicateEventsCount: 1,
      rejectedEventsCount: 0,
    });
    expect(typeof statsAfterStress.averageProcessingTimeMs).toBe('number');

    await request(app.getHttpServer())
      .post('/api/events')
      .send(forbiddenBatch)
      .expect(201)
      .expect((response) => {
        const body = response.body as QueueEventsResponse;

        expect(body.summary).toMatchObject({ queued: 4 });
      });

    const statsAfterForbidden = await waitForStats({
      finalizedEventsCount: 10,
    });

    expect(statsAfterForbidden).toMatchObject({
      validEventsCount: 7,
      duplicateEventsCount: 1,
      rejectedEventsCount: 2,
    });

    expect(
      await readDecisionCounts(stressOrderId, EngineDecision.Rejected),
    ).toHaveLength(0);

    expect(
      await readDecisionCounts(forbiddenOrderId, EngineDecision.Rejected),
    ).toContainEqual({
      decision: EngineDecision.Rejected,
      reason_code: 'FORBIDDEN_TRANSITION',
      count: 2,
    });
  });

  it('returns current state, history, rejected decisions and audit log for an order', async () => {
    const orderId = 'ord-read-model-001';
    const batch = [
      {
        eventId: 'evt-read-model-001',
        orderId,
        type: 'ORDER_CREATED',
        timestamp: 1710004000,
        payload: { amount: 80, currency: 'PLN' },
      },
      {
        eventId: 'evt-read-model-002',
        orderId,
        type: 'ORDER_CANCELLED',
        timestamp: 1710004100,
        payload: {},
      },
      {
        eventId: 'evt-read-model-003',
        orderId,
        type: 'PAYMENT_CAPTURED',
        timestamp: 1710004200,
        payload: { amount: 80 },
      },
      {
        eventId: 'evt-read-model-004',
        orderId,
        type: 'REFUND_ISSUED',
        timestamp: 1710004300,
        payload: { refundAmount: 80 },
      },
    ];

    await request(app.getHttpServer())
      .post('/api/events')
      .send(batch)
      .expect(201);

    await waitForStats({ finalizedEventsCount: 4 });

    await request(app.getHttpServer())
      .get(`/api/orders/${orderId}`)
      .expect(200)
      .expect((response) => {
        const body = response.body as OrderDetailsResponse;

        expect(body).toMatchObject({
          orderId,
          currentState: {
            orderId,
            status: 'CANCELLED',
            amountMinor: 8000,
            currency: 'PLN',
            paidAmountMinor: 0,
            refundedAmountMinor: 0,
          },
          pendingJobs: [],
        });
        expect(body.history).toHaveLength(2);
        expect(body.history).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              eventId: 'evt-read-model-001',
              type: 'ORDER_CREATED',
              fromStatus: null,
              toStatus: 'CREATED',
              decision: 'ACCEPTED',
              reasonCode: 'APPLIED',
              changedFields: {
                status: 'CREATED',
                amountMinor: 8000,
                currency: 'PLN',
              },
            }),
            expect.objectContaining({
              eventId: 'evt-read-model-002',
              type: 'ORDER_CANCELLED',
              fromStatus: 'CREATED',
              toStatus: 'CANCELLED',
              decision: 'ACCEPTED',
              reasonCode: 'APPLIED',
              changedFields: { status: 'CANCELLED' },
            }),
          ]),
        );
        expect(body.rejectedEvents).toEqual([
          expect.objectContaining({
            eventId: 'evt-read-model-003',
            type: 'PAYMENT_CAPTURED',
            decision: 'REJECTED',
            reasonCode: 'FORBIDDEN_TRANSITION',
          }),
          expect.objectContaining({
            eventId: 'evt-read-model-004',
            type: 'REFUND_ISSUED',
            decision: 'REJECTED',
            reasonCode: 'FORBIDDEN_TRANSITION',
          }),
        ]);
        expect(body.auditLog).toHaveLength(4);
      });
  });

  it('returns test-only event inspector details for an event id', async () => {
    const eventId = 'evt-inspector-001';
    const orderId = 'ord-inspector-001';
    const event = {
      eventId,
      orderId,
      type: 'ORDER_CREATED',
      timestamp: 1710001000,
      payload: { amount: 80, currency: 'PLN' },
    };

    await request(app.getHttpServer())
      .post('/api/events')
      .send([event, event])
      .expect(201);

    await waitForStats({ finalizedEventsCount: 2 });

    await request(app.getHttpServer())
      .get(`/api/events/${eventId}`)
      .expect(200)
      .expect((response) => {
        const body = response.body as EventDetailsResponse;

        expect(body).toMatchObject({
          eventId,
          orderIds: [orderId],
        });
        expect(body.deliveries).toHaveLength(2);
        expect(body.deliveries[0]).toMatchObject({
          eventId,
          orderId,
          rawEvent: event,
          payload: event.payload,
          processing: { status: ProcessingStatus.Done },
        });
        expect(body.decisions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              eventId,
              decision: EngineDecision.Accepted,
            }),
            expect.objectContaining({
              eventId,
              decision: EngineDecision.Duplicate,
            }),
          ]),
        );
        expect(body.history).toEqual([
          expect.objectContaining({
            eventId,
            orderId,
            decision: EngineDecision.Accepted,
          }),
        ]);
      });
  });

  it('returns 404 for an unknown event inspector id', async () => {
    await request(app.getHttpServer())
      .get('/api/events/evt-does-not-exist')
      .expect(404);
  });

  it('keeps an event retryable while its required order does not exist', async () => {
    const orderId = 'ord-read-deferred-001';

    await request(app.getHttpServer())
      .post('/api/events')
      .send([
        {
          eventId: 'evt-read-deferred-001',
          orderId,
          type: 'PAYMENT_CAPTURED',
          timestamp: 1710002000,
          payload: { amount: 120 },
        },
      ])
      .expect(201);

    const order = await waitForOrder(orderId);

    expect(order).toMatchObject({
      orderId,
      currentState: null,
      history: [],
      rejectedEvents: [],
      auditLog: [],
    });
    expect(order.pendingJobs).toEqual([
      expect.objectContaining({
        eventId: 'evt-read-deferred-001',
        orderId,
        type: 'PAYMENT_CAPTURED',
        status: 'RETRY',
        attempts: 1,
        lastErrorMessage: 'Event requires an existing order',
      }),
    ]);
  });

  it('returns 404 for a completely unknown order', async () => {
    await request(app.getHttpServer())
      .get('/api/orders/ord-does-not-exist')
      .expect(404);
  });

  it('treats a repeated forbidden batch as duplicate deliveries', async () => {
    const orderId = 'ord-repeat-state-001';
    const forbiddenBatch = [
      {
        eventId: 'evt-repeat-state-001',
        orderId,
        type: 'ORDER_CREATED',
        timestamp: 1710004000,
        payload: { amount: 80, currency: 'PLN' },
      },
      {
        eventId: 'evt-repeat-state-002',
        orderId,
        type: 'ORDER_CANCELLED',
        timestamp: 1710004100,
        payload: {},
      },
      {
        eventId: 'evt-repeat-state-003',
        orderId,
        type: 'PAYMENT_CAPTURED',
        timestamp: 1710004200,
        payload: { amount: 80 },
      },
      {
        eventId: 'evt-repeat-state-004',
        orderId,
        type: 'REFUND_ISSUED',
        timestamp: 1710004300,
        payload: { refundAmount: 80 },
      },
    ];

    await request(app.getHttpServer())
      .post('/api/events')
      .send(forbiddenBatch)
      .expect(201);

    await waitForStats({ finalizedEventsCount: 4 });

    await request(app.getHttpServer())
      .post('/api/events')
      .send(forbiddenBatch)
      .expect(201);

    const stats = await waitForStats({ finalizedEventsCount: 8 });

    expect(stats).toMatchObject({
      rejectedEventsCount: 2,
      duplicateEventsCount: 4,
    });

    expect(await readDecisionCounts(orderId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason_code: 'APPLIED',
          count: 2,
        }),
        expect.objectContaining({
          reason_code: 'DUPLICATE_EVENT',
          count: 4,
        }),
        expect.objectContaining({
          reason_code: 'FORBIDDEN_TRANSITION',
          count: 2,
        }),
      ]),
    );
  });

  it('preserves missing fields and partially merges stale field updates', async () => {
    const orderId = 'ord-partial-fields-001';
    const batch = [
      {
        eventId: 'evt-partial-fields-001',
        orderId,
        type: 'ORDER_CREATED',
        timestamp: 1710001000,
        payload: { amount: 100, currency: 'PLN' },
      },
      {
        eventId: 'evt-partial-fields-003',
        orderId,
        type: 'ORDER_UPDATED',
        timestamp: 1710003000,
        payload: { amount: 150 },
      },
      {
        eventId: 'evt-partial-fields-002',
        orderId,
        type: 'ORDER_UPDATED',
        timestamp: 1710002000,
        payload: { amount: 120, currency: 'EUR' },
      },
    ];

    await request(app.getHttpServer())
      .post('/api/events')
      .send(batch.slice(0, 2))
      .expect(201);

    await waitForStats({ finalizedEventsCount: 2 });

    await request(app.getHttpServer())
      .post('/api/events')
      .send(batch.slice(2))
      .expect(201);

    const stats = await waitForStats({ finalizedEventsCount: 3 });

    expect(stats).toMatchObject({
      validEventsCount: 3,
      rejectedEventsCount: 0,
    });

    expect(await readOrder(orderId)).toMatchObject({
      status: 'CREATED',
      amount_minor: 15000,
      currency: 'EUR',
    });

    const partialDecision = await readDecision('evt-partial-fields-002');

    expect(partialDecision).toMatchObject({
      decision: 'PARTIALLY_APPLIED',
      reason_code: 'PARTIAL_MERGE',
    });
    expect(JSON.parse(partialDecision.changed_fields_json)).toEqual({
      currency: 'EUR',
    });
    expect(JSON.parse(partialDecision.skipped_fields_json)).toEqual({
      amountMinor: 'OBSOLETE_FIELD',
    });
  });

  it('rejects repeated payment capture and refunds above captured amount', async () => {
    const orderId = 'ord-payment-guards-001';
    const batch = [
      {
        eventId: 'evt-payment-guards-001',
        orderId,
        type: 'ORDER_CREATED',
        timestamp: 1710001000,
        payload: { amount: 50, currency: 'PLN' },
      },
      {
        eventId: 'evt-payment-guards-002',
        orderId,
        type: 'PAYMENT_CAPTURED',
        timestamp: 1710002000,
        payload: { amount: 50 },
      },
      {
        eventId: 'evt-payment-guards-003',
        orderId,
        type: 'PAYMENT_CAPTURED',
        timestamp: 1710003000,
        payload: { amount: 50 },
      },
      {
        eventId: 'evt-payment-guards-004',
        orderId,
        type: 'REFUND_ISSUED',
        timestamp: 1710004000,
        payload: { refundAmount: 60 },
      },
    ];

    await request(app.getHttpServer())
      .post('/api/events')
      .send(batch)
      .expect(201);

    const stats = await waitForStats({ finalizedEventsCount: 4 });

    expect(stats).toMatchObject({
      rejectedEventsCount: 2,
      duplicateEventsCount: 0,
    });

    expect(await readOrder(orderId)).toMatchObject({
      status: 'PAID',
      paid_amount_minor: 5000,
      refunded_amount_minor: 0,
    });

    expect(await readDecisionCounts(orderId, EngineDecision.Rejected)).toEqual([
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

  afterEach(async () => {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
  });

  async function readOrder(orderId: string): Promise<{
    status: string;
    amount_minor: number | null;
    paid_amount_minor: number;
    refunded_amount_minor: number;
    currency: string | null;
  }> {
    const order = await app
      .get(DataSource)
      .getRepository(OrderEntity)
      .findOneByOrFail({ orderId });

    return {
      status: order.status,
      amount_minor: order.amountMinor,
      paid_amount_minor: order.paidAmountMinor,
      refunded_amount_minor: order.refundedAmountMinor,
      currency: order.currency,
    };
  }

  async function readDecision(eventId: string): Promise<{
    decision: string;
    reason_code: string;
    changed_fields_json: string;
    skipped_fields_json: string;
  }> {
    const raw = await app
      .get(DataSource)
      .getRepository(RawIncomingEventEntity)
      .findOneByOrFail({ eventId });
    const decision = await app
      .get(DataSource)
      .getRepository(EventDecisionEntity)
      .findOneByOrFail({ rawIncomingEventId: raw.id });

    return {
      decision: decision.decision,
      reason_code: decision.reasonCode,
      changed_fields_json: decision.changedFieldsJson,
      skipped_fields_json: decision.skippedFieldsJson,
    };
  }

  async function readDecisionCounts(
    orderId?: string,
    decision?: EngineDecision,
  ): Promise<
    Array<{ decision: EngineDecision; reason_code: string; count: number }>
  > {
    const query = app
      .get(DataSource)
      .getRepository(EventDecisionEntity)
      .createQueryBuilder('decisionRow')
      .innerJoin(
        RawIncomingEventEntity,
        'raw',
        'raw.id = decisionRow.rawIncomingEventId',
      );
    if (orderId) {
      query.andWhere('raw.orderId = :orderId', { orderId });
    }
    if (decision) {
      query.andWhere('decisionRow.decision = :decision', { decision });
    }
    const rows = await query.getMany();
    const grouped = new Map<
      string,
      { decision: EngineDecision; reason_code: string; count: number }
    >();

    for (const row of rows) {
      const key = `${row.decision}:${row.reasonCode}`;
      const entry = grouped.get(key) ?? {
        decision: row.decision,
        reason_code: row.reasonCode,
        count: 0,
      };
      entry.count += 1;
      grouped.set(key, entry);
    }

    return [...grouped.values()].sort((left, right) =>
      `${left.decision}:${left.reason_code}`.localeCompare(
        `${right.decision}:${right.reason_code}`,
      ),
    );
  }

  async function waitForStats(
    expected: Partial<Record<string, number>>,
  ): Promise<Record<string, number>> {
    let latest: Record<string, number> = {};

    for (let attempt = 0; attempt < 30; attempt += 1) {
      latest = await request(app.getHttpServer())
        .get('/api/stats')
        .expect(200)
        .then((response) => response.body as Record<string, number>);

      const matched = Object.entries(expected).every(([key, value]) =>
        key === 'finalizedEventsCount'
          ? latest.validEventsCount +
              latest.rejectedEventsCount +
              latest.duplicateEventsCount ===
            value
          : latest[key] === value,
      );

      if (matched) {
        return latest;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return latest;
  }

  async function waitForOrder(orderId: string): Promise<OrderDetailsResponse> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await request(app.getHttpServer()).get(
        `/api/orders/${orderId}`,
      );
      const body = response.body as Partial<OrderDetailsResponse>;

      if (
        response.status === 200 &&
        ((body.auditLog?.length ?? 0) > 0 ||
          (body.pendingJobs ?? []).some(
            (job) => job.status === ProcessingStatus.Retry,
          ))
      ) {
        return body as OrderDetailsResponse;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(`Order ${orderId} was not available in time`);
  }
});
