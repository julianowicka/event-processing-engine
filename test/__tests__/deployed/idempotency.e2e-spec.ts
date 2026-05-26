import {
  createDeployedApiClient,
  DeployedApiClient,
  describeDeployed,
  EventDetailsResponse,
  QueueResponse,
} from './support/deployed-api-client';
import {
  createdEvent,
  eventId,
  orderId,
  paidEvent,
  uniqueRunId,
} from './support/event-factory';
import { waitForOrder } from './support/wait-for';

describeDeployed('Deployed idempotency and retry behaviour (e2e)', () => {
  let client: DeployedApiClient;

  jest.setTimeout(45_000);

  beforeAll(() => {
    client = createDeployedApiClient();
  });

  it('marks repeated deliveries as duplicates without changing order state twice', async () => {
    const runId = uniqueRunId('dupe');
    const id = orderId(runId);
    const batch = [createdEvent(runId, 1), paidEvent(runId, 2)];

    await client.post<QueueResponse>('/api/events', batch);
    await waitForOrder(
      client,
      id,
      (candidate) => candidate.currentState?.status === 'PAID',
    );

    await client.post<QueueResponse>('/api/events', batch);

    const order = await waitForOrder(
      client,
      id,
      (candidate) =>
        candidate.currentState?.status === 'PAID' &&
        candidate.rejectedEvents.length === 2,
    );

    expect(order.currentState).toMatchObject({
      status: 'PAID',
      paidAmountMinor: 10000,
      refundedAmountMinor: 0,
    });
    expect(order.history.map((entry) => entry.eventId)).toEqual([
      eventId(runId, 1),
      eventId(runId, 2),
    ]);
    expect(order.rejectedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: eventId(runId, 1),
          reasonCode: 'DUPLICATE_EVENT',
        }),
        expect.objectContaining({
          eventId: eventId(runId, 2),
          reasonCode: 'DUPLICATE_EVENT',
        }),
      ]),
    );

    const paidEventDetails = await client.get<EventDetailsResponse>(
      `/api/events/${eventId(runId, 2)}`,
    );

    expect(paidEventDetails.status).toBe(200);
    expect(paidEventDetails.body.deliveries).toHaveLength(2);
    expect(paidEventDetails.body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ decision: 'ACCEPTED' }),
        expect.objectContaining({ decision: 'DUPLICATE' }),
      ]),
    );
  });
});
