import type { JsonValue } from '../../../common/json.types';
import { isJsonObject } from '../../../common/json.util';
import { EventValidationService } from '../event-validation.service';
import { JobStatus, ReasonCode, SupportedEventType } from '../../event.types';
import type { ProcessingJobRow } from '../../event.types';

describe('EventValidationService', () => {
  const service = new EventValidationService();

  it('validates event shape and converts money helpers', () => {
    const job = jobFromRaw({
      eventId: 'evt-valid-001',
      orderId: 'ord-valid-001',
      type: SupportedEventType.OrderCreated,
      timestamp: 1710001000,
      payload: { amount: 19.99, currency: 'PLN' },
    });

    const result = service.validateRawEvent(job);

    expect(result).toMatchObject({
      valid: true,
      event: {
        eventId: 'evt-valid-001',
        orderId: 'ord-valid-001',
        type: SupportedEventType.OrderCreated,
        timestamp: 1710001000,
        payload: { amount: 19.99, currency: 'PLN' },
      },
    });
    expect(service.optionalMoneyToMinor(19.99)).toBe(1999);
    expect(service.positiveMoneyToMinor(0)).toBeNull();
  });

  it('rejects malformed and unsupported events with stable reason codes', () => {
    expect(service.validateRawEvent(jobFromRaw('not an object'))).toMatchObject(
      {
        valid: false,
        reasonCode: ReasonCode.InvalidSchema,
      },
    );

    expect(
      service.validateRawEvent(
        jobFromRaw({
          eventId: 'evt-unknown-001',
          orderId: 'ord-unknown-001',
          type: 'ALIEN_SIGNAL',
          timestamp: 1710001000,
          payload: {},
        }),
      ),
    ).toMatchObject({
      valid: false,
      reasonCode: ReasonCode.UnknownEventType,
    });
  });

  function jobFromRaw(raw: JsonValue): ProcessingJobRow {
    const record = isJsonObject(raw) ? raw : null;

    return {
      job_id: 1,
      raw_incoming_event_id: 1,
      status: JobStatus.Pending,
      attempts: 0,
      locked_by: null,
      locked_at: null,
      raw_event_json: JSON.stringify(raw),
      event_id: record ? readString(record.eventId) : null,
      order_id: record ? readString(record.orderId) : null,
      type: record ? readString(record.type) : null,
      event_timestamp:
        record && typeof record.timestamp === 'number'
          ? record.timestamp
          : null,
    };
  }

  function readString(value: JsonValue | undefined): string | null {
    if (value === undefined) {
      return null;
    }

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      return String(value);
    }

    return JSON.stringify(value) ?? null;
  }
});
