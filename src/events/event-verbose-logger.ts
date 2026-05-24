import type { Logger } from '@nestjs/common';
import type { JsonObject } from '../common/json.types';

export function verboseLog(
  logger: Pick<Logger, 'log'>,
  message: string,
  details: JsonObject,
): void {
  if (!isVerboseLoggingEnabled()) {
    return;
  }

  logger.log(`${message} ${JSON.stringify(details)}`);
}

function isVerboseLoggingEnabled(): boolean {
  return (
    process.env.EVENT_WORKER_VERBOSE_LOGS === 'true' ||
    process.env.EVENT_WORKER_VERBOSE_LOGS === '1'
  );
}
