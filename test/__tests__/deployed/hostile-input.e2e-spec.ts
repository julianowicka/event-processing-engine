import type { JsonObject, JsonValue } from '../../../src/common/json.types';
import {
  createDeployedApiClient,
  DeployedApiClient,
  describeDeployed,
  QueueResponse,
} from './support/deployed-api-client';
import {
  cancelledEvent,
  createdEvent,
  eventId,
  orderId,
  paidEvent,
  refundedEvent,
  uniqueRunId,
  updatedEvent,
} from './support/event-factory';
import { waitForOrder } from './support/wait-for';

describeDeployed('Deployed API hostile input scenarios (e2e)', () => {
  let client: DeployedApiClient;

  jest.setTimeout(45_000);

  beforeAll(() => {
    client = createDeployedApiClient();
  });

  it('rejects non-array request bodies before queueing', async () => {
    const response = await client.post<JsonObject>('/api/events', {
      eventId: 'not-a-batch',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 400,
        message: 'Request body must be an array',
      }),
    );
  });

  it('persists malformed batch items but finalizes them as rejected decisions', async () => {
    const runId = uniqueRunId('hostile');
    const id = orderId(runId);
    const hostileBatch: JsonValue[] = [
      paidEvent(runId, 2),
      createdEvent(runId, 1),
      paidEvent(runId, 2),
      updatedEvent(runId, 3, {
        timestamp: 1710000900,
        payload: { amount: 1, currency: 'USD', status: 'CANCELLED' },
      }),
      {
        eventId: eventId(runId, 4),
        orderId: id,
        type: 'REFUND_ISSUED',
        timestamp: 1710004000,
        payload: { refundAmount: -30 },
      },
      {
        eventId: '',
        orderId: id,
        type: 'ORDER_UPDATED',
        timestamp: 1710005000,
        payload: null,
      },
      {
        orderId: id,
        type: 'ALIEN_SIGNAL',
        timestamp: 'not-a-number',
        payload: null,
      },
      'not even an object',
      null,
    ];

    const queued = await client.post<QueueResponse>(
      '/api/events',
      hostileBatch,
    );

    expect(queued.status).toBe(201);
    expect(queued.body.summary).toEqual({ queued: hostileBatch.length });
    expect(queued.body.results).toHaveLength(hostileBatch.length);

    const order = await waitForOrder(
      client,
      id,
      (candidate) =>
        candidate.auditLog.length >= 7 && candidate.pendingJobs.length === 0,
    );

    expect(order.currentState).toMatchObject({
      status: 'PAID',
      amountMinor: 10000,
      currency: 'PLN',
      paidAmountMinor: 10000,
      refundedAmountMinor: 0,
    });
    expect(order.auditLog.length).toBeGreaterThanOrEqual(7);
    expect(order.rejectedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: eventId(runId, 2) }),
        expect.objectContaining({ eventId: eventId(runId, 4) }),
        expect.objectContaining({ reasonCode: 'INVALID_SCHEMA' }),
      ]),
    );
  });

  it('surfaces forbidden transitions instead of mutating cancelled orders', async () => {
    const runId = uniqueRunId('forbidden');
    const id = orderId(runId);
    const batch = [
      createdEvent(runId, 1, { payload: { amount: 80, currency: 'PLN' } }),
      cancelledEvent(runId, 2, { timestamp: 1710001500 }),
      paidEvent(runId, 3, { payload: { amount: 80 } }),
      refundedEvent(runId, 4, { payload: { refundAmount: 80 } }),
    ];

    await client.post<QueueResponse>('/api/events', batch);

    const order = await waitForOrder(
      client,
      id,
      (candidate) =>
        candidate.currentState?.status === 'CANCELLED' &&
        candidate.rejectedEvents.length === 2,
    );

    expect(order.currentState).toMatchObject({
      status: 'CANCELLED',
      paidAmountMinor: 0,
      refundedAmountMinor: 0,
    });
    expect(order.rejectedEvents).toEqual([
      expect.objectContaining({
        eventId: eventId(runId, 3),
        reasonCode: 'FORBIDDEN_TRANSITION',
      }),
      expect.objectContaining({
        eventId: eventId(runId, 4),
        reasonCode: 'FORBIDDEN_TRANSITION',
      }),
    ]);
  });
});
