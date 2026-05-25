import { config } from 'dotenv';

config({ quiet: true });

const DEFAULT_EVENT_RETRY_DELAY_MS = 5_000;

export function getEventRetryDelayMs(): number {
  const configuredRetryDelayMs = Number(process.env.EVENT_RETRY_DELAY_MS);

  return Number.isInteger(configuredRetryDelayMs) && configuredRetryDelayMs > 0
    ? configuredRetryDelayMs
    : DEFAULT_EVENT_RETRY_DELAY_MS;
}
