import {
  createDeployedApiClient,
  DeployedApiClient,
  describeDeployed,
  StatsResponse,
} from './support/deployed-api-client';

interface HealthResponse {
  status: string;
  database: string;
  timestamp: string;
}

describeDeployed('Deployed API health and public contract (e2e)', () => {
  let client: DeployedApiClient;

  beforeAll(() => {
    client = createDeployedApiClient();
  });

  it('exposes health and stats through the deployed HTTPS route', async () => {
    const health = await client.get<HealthResponse>('/api/health');

    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ status: 'ok' });
    expect(typeof health.body.database).toBe('string');
    expect(typeof health.body.timestamp).toBe('string');

    const stats = await client.get<StatsResponse>('/api/stats');

    expect(stats.status).toBe(200);
    expect(Object.keys(stats.body).sort()).toEqual([
      'averageProcessingTimeMs',
      'duplicateEventsCount',
      'rejectedEventsCount',
      'validEventsCount',
    ]);
    expect(typeof stats.body.validEventsCount).toBe('number');
    expect(typeof stats.body.rejectedEventsCount).toBe('number');
    expect(typeof stats.body.duplicateEventsCount).toBe('number');
    expect(typeof stats.body.averageProcessingTimeMs).toBe('number');
  });
});
