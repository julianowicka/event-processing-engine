import { EventValidationService } from './event-validation.service';
import type { ProcessingJobRow } from '../event.types';

describe('EventValidationService', () => {
  const service = new EventValidationService();

  it('validates event shape and converts money helpers', () => {
    const job = jobFromRaw({
      eventId: 'evt-valid-001',
      orderId: 'ord-valid-001',
      type: 'ORDER_CREATED',
      timestamp: 1710001000,
      payload: { amount: 19.99, currency: 'PLN' },
    });

    const result = service.validateRawEvent(job);

    expect(result).toMatchObject({
      valid: true,
      event: {
        eventId: 'evt-valid-001',
        orderId: 'ord-valid-001',
        type: 'ORDER_CREATED',
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
        reasonCode: 'INVALID_SCHEMA',
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
      reasonCode: 'UNKNOWN_EVENT_TYPE',
    });
  });

  function jobFromRaw(raw: unknown): ProcessingJobRow {
    return {
      job_id: 1,
      raw_incoming_event_id: 1,
      status: 'PENDING',
      attempts: 0,
      locked_by: null,
      locked_at: null,
      raw_event_json: JSON.stringify(raw),
      event_id:
        typeof raw === 'object' && raw !== null && 'eventId' in raw
          ? String((raw as { eventId: unknown }).eventId)
          : null,
      order_id:
        typeof raw === 'object' && raw !== null && 'orderId' in raw
          ? String((raw as { orderId: unknown }).orderId)
          : null,
      type:
        typeof raw === 'object' && raw !== null && 'type' in raw
          ? String((raw as { type: unknown }).type)
          : null,
      event_timestamp:
        typeof raw === 'object' &&
        raw !== null &&
        'timestamp' in raw &&
        typeof (raw as { timestamp: unknown }).timestamp === 'number'
          ? (raw as { timestamp: number }).timestamp
          : null,
    };
  }
});
