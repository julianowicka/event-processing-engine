import {
  createDeployedApiClient,
  DeployedApiClient,
  describeDeployed,
  EventDetailsResponse,
  QueueResponse,
  StatsResponse,
} from './support/deployed-api-client';
import {
  createdEvent,
  eventId,
  orderId,
  paidEvent,
  refundedEvent,
  uniqueRunId,
} from './support/event-factory';
import { waitForOrder } from './support/wait-for';

describeDeployed('Deployed order processing flows (e2e)', () => {
  let client: DeployedApiClient;

  jest.setTimeout(45_000);

  beforeAll(() => {
    client = createDeployedApiClient();
  });

  it('processes an out-of-order paid and refunded order end to end', async () => {
    const runId = uniqueRunId('flow');
    const id = orderId(runId);
    const batch = [
      refundedEvent(runId, 3),
      paidEvent(runId, 2),
      createdEvent(runId, 1),
    ];

    const queued = await client.post<QueueResponse>('/api/events', batch);

    expect(queued.status).toBe(201);
    expect(queued.body).toMatchObject({
      mode: 'ASYNC_WORKER',
      summary: { queued: 3 },
    });

    const order = await waitForOrder(
      client,
      id,
      (candidate) =>
        candidate.currentState?.status === 'PARTIALLY_REFUNDED' &&
        candidate.history.length === 3 &&
        candidate.pendingJobs.length === 0,
    );

    expect(order).toMatchObject({
      orderId: id,
      currentState: {
        orderId: id,
        status: 'PARTIALLY_REFUNDED',
        amountMinor: 10000,
        currency: 'PLN',
        paidAmountMinor: 10000,
        refundedAmountMinor: 2500,
      },
      rejectedEvents: [],
      pendingJobs: [],
    });
    expect(order.history.map((entry) => entry.eventId)).toEqual([
      eventId(runId, 1),
      eventId(runId, 2),
      eventId(runId, 3),
    ]);

    const eventDetails = await client.get<EventDetailsResponse>(
      `/api/events/${eventId(runId, 1)}`,
    );

    expect(eventDetails.status).toBe(200);
    expect(eventDetails.body).toMatchObject({
      eventId: eventId(runId, 1),
      orderIds: [id],
    });
    expect(eventDetails.body.decisions).toEqual([
      expect.objectContaining({
        decision: 'ACCEPTED',
        reasonCode: 'APPLIED',
      }),
    ]);

    const stats = await client.get<StatsResponse>('/api/stats');

    expect(stats.status).toBe(200);
    expect(stats.body.validEventsCount).toBeGreaterThanOrEqual(batch.length);
  });
});
