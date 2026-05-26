import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import type { JsonValue } from '../../src/common/json.types';
import {
  EngineDecision,
  OrderStatus,
  type QueueEventsResponse,
} from '../../src/events/types/event.types';
import type { OrderDetailsResponse } from '../../src/orders/orders.types';

interface StatsResponse {
  validEventsCount: number;
  rejectedEventsCount: number;
  duplicateEventsCount: number;
  averageProcessingTimeMs: number;
}

describe('Recruitment task requirements (e2e)', () => {
  let app: INestApplication<App>;
  let directory: string;

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recruitment-e2e-'));
    process.env.SQLITE_DB_PATH = path.join(directory, 'database.sqlite');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
  });

  it('accepts event batches and exposes current order state, history, rejected events and stats', async () => {
    const orderId = 'ord-req-api-001';
    const batch = [
      {
        eventId: 'evt-req-api-001',
        orderId,
        type: 'ORDER_CREATED',
        timestamp: 1710001000,
        payload: { amount: 199.99, currency: 'PLN' },
      },
      {
        eventId: 'evt-req-api-002',
        orderId,
        type: 'PAYMENT_CAPTURED',
        timestamp: 1710002000,
        payload: { amount: 199.99 },
      },
      {
        eventId: 'evt-req-api-003',
        orderId,
        type: 'REFUND_ISSUED',
        timestamp: 1710003000,
        payload: { refundAmount: 50 },
      },
    ];

    await request(app.getHttpServer())
      .post('/api/events')
      .send(batch)
      .expect(201)
      .expect((response) => {
        const body = response.body as QueueEventsResponse;

        expect(body).toMatchObject({
          mode: 'ASYNC_WORKER',
          summary: { queued: batch.length },
        });
        expect(body.results).toHaveLength(batch.length);
      });

    const order = await waitForOrder(
      orderId,
      (candidate) =>
        candidate.currentState?.status === OrderStatus.PartiallyRefunded,
    );

    expect(order).toMatchObject({
      orderId,
      currentState: {
        orderId,
        status: 'PARTIALLY_REFUNDED',
        amount: 199.99,
        currency: 'PLN',
        paidAmount: 199.99,
        refundedAmount: 50,
      },
      rejectedEvents: [],
      pendingJobs: [],
    });
    expect(order.currentState).not.toHaveProperty('amountMinor');
    expect(order.currentState).not.toHaveProperty('paidAmountMinor');
    expect(order.currentState).not.toHaveProperty('refundedAmountMinor');
    expect(order.history.map((entry) => entry.eventId)).toEqual([
      'evt-req-api-001',
      'evt-req-api-002',
      'evt-req-api-003',
    ]);
    expect(order.auditLog).toHaveLength(3);

    const stats = await waitForStats({ validEventsCount: 3 });

    expect(stats).toMatchObject({
      validEventsCount: 3,
      rejectedEventsCount: 0,
      duplicateEventsCount: 0,
    });
    expect(stats.averageProcessingTimeMs).toEqual(expect.any(Number));
  });

  it('deduplicates repeated eventId deliveries and records the ignored delivery in audit log', async () => {
    const orderId = 'ord-req-dedupe-001';
    const event = {
      eventId: 'evt-req-dedupe-001',
      orderId,
      type: 'ORDER_CREATED',
      timestamp: 1710001000,
      payload: { amount: 100, currency: 'PLN' },
    };

    await request(app.getHttpServer())
      .post('/api/events')
      .send([event, event])
      .expect(201);

    const order = await waitForOrder(
      orderId,
      (candidate) =>
        candidate.auditLog.length === 2 &&
        candidate.rejectedEvents.length === 1,
    );

    expect(order.currentState).toMatchObject({
      status: 'CREATED',
      amount: 100,
      currency: 'PLN',
    });
    expect(order.history).toEqual([
      expect.objectContaining({
        eventId: event.eventId,
        decision: 'ACCEPTED',
        reasonCode: 'APPLIED',
      }),
    ]);
    expect(order.rejectedEvents).toEqual([
      expect.objectContaining({
        eventId: event.eventId,
        decision: 'DUPLICATE',
        reasonCode: 'DUPLICATE_EVENT',
      }),
    ]);

    expect(await waitForStats({ duplicateEventsCount: 1 })).toMatchObject({
      validEventsCount: 1,
      rejectedEventsCount: 0,
      duplicateEventsCount: 1,
    });
  });

  it('handles out-of-order stale events with a documented partial merge strategy', async () => {
    const orderId = 'ord-req-ordering-001';

    await request(app.getHttpServer())
      .post('/api/events')
      .send([
        {
          eventId: 'evt-req-ordering-001',
          orderId,
          type: 'ORDER_CREATED',
          timestamp: 1710001000,
          payload: { amount: 100, currency: 'PLN' },
        },
        {
          eventId: 'evt-req-ordering-003',
          orderId,
          type: 'ORDER_UPDATED',
          timestamp: 1710003000,
          payload: { amount: 250 },
        },
      ])
      .expect(201);

    await waitForStats({ validEventsCount: 2 });

    await request(app.getHttpServer())
      .post('/api/events')
      .send([
        {
          eventId: 'evt-req-ordering-002',
          orderId,
          type: 'ORDER_UPDATED',
          timestamp: 1710002000,
          payload: { amount: 150, currency: 'EUR' },
        },
      ])
      .expect(201);

    const order = await waitForOrder(orderId, (candidate) =>
      candidate.history.some(
        (entry) =>
          entry.eventId === 'evt-req-ordering-002' &&
          entry.decision === EngineDecision.PartiallyApplied,
      ),
    );

    expect(order.currentState).toMatchObject({
      status: 'CREATED',
      amount: 250,
      currency: 'EUR',
      paidAmount: 0,
      refundedAmount: 0,
    });
    expect(order.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: 'evt-req-ordering-002',
          decision: 'PARTIALLY_APPLIED',
          reasonCode: 'PARTIAL_MERGE',
          changedFields: { currency: 'EUR' },
          skippedFields: { amount: 'OBSOLETE_FIELD' },
        }),
      ]),
    );
  });

  it('preserves missing fields during partial updates', async () => {
    const orderId = 'ord-req-partial-001';

    await request(app.getHttpServer())
      .post('/api/events')
      .send([
        {
          eventId: 'evt-req-partial-001',
          orderId,
          type: 'ORDER_CREATED',
          timestamp: 1710001000,
          payload: { amount: 120, currency: 'PLN' },
        },
        {
          eventId: 'evt-req-partial-002',
          orderId,
          type: 'ORDER_UPDATED',
          timestamp: 1710002000,
          payload: { amount: 250 },
        },
      ])
      .expect(201);

    const order = await waitForOrder(
      orderId,
      (candidate) => candidate.currentState?.amount === 250,
    );

    expect(order.currentState).toMatchObject({
      status: 'CREATED',
      amount: 250,
      currency: 'PLN',
    });
  });

  it('rejects invalid events and reports why they were rejected', async () => {
    const orderId = 'ord-req-invalid-001';
    const batch = [
      {
        eventId: 'evt-req-invalid-001',
        orderId,
        type: 'ORDER_CREATED',
        timestamp: 1710001000,
        payload: { amount: 10, currency: 'PLN' },
      },
      {
        eventId: 'evt-req-invalid-002',
        orderId,
        type: 'ALIEN_EVENT',
        timestamp: 1710002000,
        payload: {},
      },
      {
        eventId: '',
        orderId,
        type: 'ORDER_UPDATED',
        timestamp: 1710003000,
        payload: { amount: 20 },
      },
    ];

    await request(app.getHttpServer())
      .post('/api/events')
      .send(batch)
      .expect(201);

    const order = await waitForOrder(
      orderId,
      (candidate) => candidate.rejectedEvents.length === 2,
    );

    expect(order.rejectedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: 'evt-req-invalid-002',
          reasonCode: 'UNKNOWN_EVENT_TYPE',
        }),
        expect.objectContaining({
          eventId: '',
          reasonCode: 'INVALID_SCHEMA',
        }),
      ]),
    );
    expect(await waitForStats({ rejectedEventsCount: 2 })).toMatchObject({
      validEventsCount: 1,
      rejectedEventsCount: 2,
      duplicateEventsCount: 0,
    });
  });

  it('enforces state machine rules: CANCELLED to PAID is rejected, PAID to REFUNDED is accepted', async () => {
    const cancelledOrderId = 'ord-req-state-cancelled-001';
    const refundedOrderId = 'ord-req-state-refunded-001';

    await request(app.getHttpServer())
      .post('/api/events')
      .send([
        {
          eventId: 'evt-req-state-cancelled-001',
          orderId: cancelledOrderId,
          type: 'ORDER_CREATED',
          timestamp: 1710001000,
          payload: { amount: 80, currency: 'PLN' },
        },
        {
          eventId: 'evt-req-state-cancelled-002',
          orderId: cancelledOrderId,
          type: 'ORDER_CANCELLED',
          timestamp: 1710001500,
          payload: {},
        },
        {
          eventId: 'evt-req-state-cancelled-003',
          orderId: cancelledOrderId,
          type: 'PAYMENT_CAPTURED',
          timestamp: 1710002000,
          payload: { amount: 80 },
        },
      ])
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/events')
      .send([
        {
          eventId: 'evt-req-state-refunded-001',
          orderId: refundedOrderId,
          type: 'ORDER_CREATED',
          timestamp: 1710001000,
          payload: { amount: 80, currency: 'PLN' },
        },
        {
          eventId: 'evt-req-state-refunded-002',
          orderId: refundedOrderId,
          type: 'PAYMENT_CAPTURED',
          timestamp: 1710002000,
          payload: { amount: 80 },
        },
        {
          eventId: 'evt-req-state-refunded-003',
          orderId: refundedOrderId,
          type: 'REFUND_ISSUED',
          timestamp: 1710003000,
          payload: { refundAmount: 80 },
        },
      ])
      .expect(201);

    const cancelledOrder = await waitForOrder(
      cancelledOrderId,
      (candidate) =>
        candidate.currentState?.status === OrderStatus.Cancelled &&
        candidate.rejectedEvents.length === 1,
    );
    const refundedOrder = await waitForOrder(
      refundedOrderId,
      (candidate) => candidate.currentState?.status === OrderStatus.Refunded,
    );

    expect(cancelledOrder.currentState).toMatchObject({
      status: 'CANCELLED',
      paidAmount: 0,
      refundedAmount: 0,
    });
    expect(cancelledOrder.rejectedEvents).toEqual([
      expect.objectContaining({
        eventId: 'evt-req-state-cancelled-003',
        reasonCode: 'FORBIDDEN_TRANSITION',
      }),
    ]);

    expect(refundedOrder.currentState).toMatchObject({
      status: 'REFUNDED',
      paidAmount: 80,
      refundedAmount: 80,
    });
    expect(refundedOrder.rejectedEvents).toEqual([]);
  });

  async function waitForOrder(
    orderId: string,
    predicate: (order: OrderDetailsResponse) => boolean,
  ): Promise<OrderDetailsResponse> {
    let latest: JsonValue = null;

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await request(app.getHttpServer()).get(
        `/api/orders/${orderId}`,
      );
      latest = response.body as JsonValue;

      if (response.status === 200) {
        const order = response.body as OrderDetailsResponse;

        if (predicate(order)) {
          return order;
        }
      }

      await sleep(50);
    }

    throw new Error(
      `Order ${orderId} did not match in time. Last response: ${JSON.stringify(
        latest,
      )}`,
    );
  }

  async function waitForStats(
    expected: Partial<StatsResponse>,
  ): Promise<StatsResponse> {
    let latest: StatsResponse = {
      validEventsCount: 0,
      rejectedEventsCount: 0,
      duplicateEventsCount: 0,
      averageProcessingTimeMs: 0,
    };

    for (let attempt = 0; attempt < 40; attempt += 1) {
      latest = await request(app.getHttpServer())
        .get('/api/stats')
        .expect(200)
        .then((response) => response.body as StatsResponse);

      if (
        Object.entries(expected).every(
          ([key, value]) => latest[key as keyof StatsResponse] === value,
        )
      ) {
        return latest;
      }

      await sleep(50);
    }

    throw new Error(
      `Stats did not match in time. Last response: ${JSON.stringify(latest)}`,
    );
  }

  async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
});
