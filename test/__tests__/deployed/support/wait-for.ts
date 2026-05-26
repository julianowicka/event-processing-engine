import type { JsonObject } from '../../../../src/common/json.types';
import {
  DeployedApiClient,
  OrderDetailsResponse,
  StatsResponse,
} from './deployed-api-client';

export async function waitForOrder(
  client: DeployedApiClient,
  orderId: string,
  predicate: (order: OrderDetailsResponse) => boolean,
  timeoutMs = 30_000,
): Promise<OrderDetailsResponse> {
  const deadline = Date.now() + timeoutMs;
  let latest = 'null';

  while (Date.now() < deadline) {
    const response = await client.get<OrderDetailsResponse | JsonObject>(
      `/api/orders/${orderId}`,
    );
    latest = JSON.stringify(response.body);

    if (response.status === 200) {
      const order = response.body as OrderDetailsResponse;

      if (predicate(order)) {
        return order;
      }
    }

    await sleep(500);
  }

  throw new Error(
    `Order ${orderId} did not reach expected state. Last response: ${latest}`,
  );
}

export async function waitForStatsAtLeast(
  client: DeployedApiClient,
  expected: Partial<StatsResponse>,
  timeoutMs = 30_000,
): Promise<StatsResponse> {
  const deadline = Date.now() + timeoutMs;
  let latest = 'null';

  while (Date.now() < deadline) {
    const response = await client.get<StatsResponse>('/api/stats');
    latest = JSON.stringify(response.body);

    if (
      response.status === 200 &&
      Object.entries(expected).every(
        ([key, value]) => response.body[key as keyof StatsResponse] >= value,
      )
    ) {
      return response.body;
    }

    await sleep(500);
  }

  throw new Error(
    `Stats did not reach expected lower bounds. Last response: ${latest}`,
  );
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
