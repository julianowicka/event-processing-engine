import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Event engine API (e2e)', () => {
  let app: INestApplication<App>;
  let directory: string;

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'event-engine-e2e-'));
    process.env.EVENT_ENGINE_DB_FILE = path.join(directory, 'database.json');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('queues events and exposes order state after background processing', async () => {
    await request(app.getHttpServer())
      .post('/events')
      .send([
        {
          eventId: 'evt-create',
          orderId: 'ord-e2e',
          type: 'ORDER_CREATED',
          timestamp: 100,
          payload: { amount: 25, currency: 'PLN' },
        },
        {
          eventId: 'evt-payment',
          orderId: 'ord-e2e',
          type: 'PAYMENT_CAPTURED',
          timestamp: 200,
          payload: { amount: 25 },
        },
      ])
      .expect(201)
      .expect((response) => {
        const body = response.body as {
          mode: string;
          results: Array<{ status: string }>;
          summary: { queued: number };
        };
        expect(body.mode).toBe('ASYNC_WORKER');
        expect(body.summary.queued).toBe(2);
        expect(body.results.map((item) => item.status)).toEqual([
          'QUEUED',
          'QUEUED',
        ]);
      });

    const body = await waitForOrder('ord-e2e');
    expect(body.currentState).toMatchObject({
      status: 'PAID',
      amountMinor: 2500,
      paidAmountMinor: 2500,
    });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
    delete process.env.EVENT_ENGINE_DB_FILE;
  });

  async function waitForOrder(orderId: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await request(app.getHttpServer()).get(
        `/orders/${orderId}`,
      );

      if (response.status === 200) {
        return response.body as { currentState: Record<string, unknown> };
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error(`Order ${orderId} was not processed in time`);
  }
});
