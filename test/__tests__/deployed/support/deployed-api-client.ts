import type { JsonValue } from '../../../../src/common/json.types';

export interface ApiResponse<TBody> {
  status: number;
  body: TBody;
  text: string;
  headers: Headers;
}

export interface QueueResponse {
  mode: string;
  summary: {
    queued: number;
  };
  results: Array<{
    eventId: string | null;
    orderId: string | null;
    type: string | null;
    status: string;
  }>;
}

export interface OrderDetailsResponse {
  orderId: string;
  currentState: {
    orderId: string;
    status: string;
    amountMinor: number | null;
    currency: string | null;
    paidAmountMinor: number;
    refundedAmountMinor: number;
  } | null;
  history: Array<{
    eventId: string;
    type: string;
    decision: string;
    reasonCode: string;
  }>;
  rejectedEvents: Array<{
    eventId: string;
    type: string;
    decision: string;
    reasonCode: string;
  }>;
  pendingJobs: Array<{
    eventId: string;
    type: string;
    status: string;
    attempts: number;
    lastErrorMessage: string | null;
  }>;
  auditLog: JsonValue[];
}

export interface EventDetailsResponse {
  eventId: string;
  orderIds: string[];
  deliveries: JsonValue[];
  decisions: Array<{
    eventId: string;
    decision: string;
    reasonCode: string;
  }>;
  history: JsonValue[];
}

export interface StatsResponse {
  validEventsCount: number;
  rejectedEventsCount: number;
  duplicateEventsCount: number;
  averageProcessingTimeMs: number;
}

export const deployedBaseUrl = process.env.E2E_BASE_URL?.trim().replace(
  /\/$/,
  '',
);

export const describeDeployed = deployedBaseUrl ? describe : describe.skip;

export class DeployedApiClient {
  constructor(private readonly baseUrl: string) {}

  get<TBody>(path: string): Promise<ApiResponse<TBody>> {
    return this.request<TBody>(path, { method: 'GET' });
  }

  post<TBody>(path: string, body: JsonValue): Promise<ApiResponse<TBody>> {
    return this.request<TBody>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async request<TBody>(
    path: string,
    init: RequestInit,
  ): Promise<ApiResponse<TBody>> {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    const text = await response.text();
    let body: TBody;

    try {
      body = JSON.parse(text) as TBody;
    } catch {
      body = text as TBody;
    }

    return {
      status: response.status,
      body,
      text,
      headers: response.headers,
    };
  }
}

export function createDeployedApiClient(): DeployedApiClient {
  if (!deployedBaseUrl) {
    throw new Error('Set E2E_BASE_URL to run deployed e2e tests');
  }

  return new DeployedApiClient(deployedBaseUrl);
}
