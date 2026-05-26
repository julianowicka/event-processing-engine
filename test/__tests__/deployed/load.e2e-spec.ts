import {
  createDeployedApiClient,
  DeployedApiClient,
  describeDeployed,
  QueueResponse,
} from './support/deployed-api-client';
import {
  createdEvent,
  orderId,
  paidEvent,
  uniqueRunId,
} from './support/event-factory';
import { waitForOrder } from './support/wait-for';

const runLoad = process.env.E2E_RUN_LOAD === 'true';
const describeLoad = runLoad ? describeDeployed : describe.skip;
const requestCount = Number(process.env.E2E_LOAD_REQUESTS ?? 1000);
const concurrency = Number(process.env.E2E_LOAD_CONCURRENCY ?? 25);

describeLoad('Deployed API load probe (e2e)', () => {
  let client: DeployedApiClient;

  jest.setTimeout(180_000);

  beforeAll(() => {
    client = createDeployedApiClient();
  });

  it('accepts many concurrent batches and still processes sampled orders', async () => {
    expect(requestCount).toBeGreaterThanOrEqual(1000);
    expect(concurrency).toBeGreaterThan(0);

    const startedAt = Date.now();
    const runId = uniqueRunId('load');
    const failures: string[] = [];
    let nextIndex = 0;

    async function worker(): Promise<void> {
      while (nextIndex < requestCount) {
        const index = nextIndex;
        nextIndex += 1;

        const childRunId = `${runId}-${index.toString().padStart(5, '0')}`;
        const response = await client.post<QueueResponse>('/api/events', [
          createdEvent(childRunId, 1),
          paidEvent(childRunId, 2),
        ]);

        if (response.status !== 201 || response.body.summary.queued !== 2) {
          failures.push(
            `#${index} status=${response.status} body=${response.text.slice(
              0,
              200,
            )}`,
          );
        }
      }
    }

    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        await worker();
      }),
    );

    expect(failures).toEqual([]);

    const sampleIndexes = [0, Math.floor(requestCount / 2), requestCount - 1];

    for (const index of sampleIndexes) {
      const childRunId = `${runId}-${index.toString().padStart(5, '0')}`;
      const id = orderId(childRunId);
      const order = await waitForOrder(
        client,
        id,
        (candidate) => candidate.currentState?.status === 'PAID',
        60_000,
      );

      expect(order.currentState).toMatchObject({
        status: 'PAID',
        amount: 100,
        paidAmount: 100,
      });
      expect(order.pendingJobs).toEqual([]);
    }

    const elapsedSeconds = (Date.now() - startedAt) / 1000;

    expect(elapsedSeconds).toBeLessThan(180);
  });
});
