# Error Handling

The engine separates HTTP request errors from event-level business decisions.

## API-Level Errors

These errors reject the whole HTTP request:

- Request body is not a JSON array.
- JSON database file cannot be read or written.

The API returns a standard NestJS error response with an appropriate HTTP status.

## Event-Level Decisions

These errors do not reject the ingestion request. They are recorded against the
individual raw delivery:

- Missing `eventId`.
- Missing `orderId`.
- Unsupported event type.
- Invalid timestamp.
- Invalid payload shape.
- Invalid money or currency field.
- Forbidden state transition.
- Obsolete field update.
- Duplicate `eventId`.
- Refund greater than captured payment.

## Deferred Is Not Rejected

If an otherwise valid event references an order that does not exist yet, the
decision is `DEFERRED`, not `REJECTED`. This supports out-of-order delivery.

## Failure Safety

Ingestion and worker processing are separate JSON database mutations. The
database service writes the file only after a mutation completes.

- If ingestion fails, no raw deliveries from that request are saved.
- If processing fails unexpectedly, the worker records the technical failure,
  schedules a retry, or moves the delivery to the DLQ after the retry limit.

Business decisions are final and are not retried. `DEFERRED` events are not
failures; they are retried after later ingestions.

## Retry And Dead Letter Policy

Implemented worker behavior:

- `DEFERRED` events are retried during later `POST /events` calls.
- A same-batch retry can also happen when a later event creates or changes the
  order needed by an earlier deferred event.
- Retry technical failures up to `3` attempts.
- Keep failed-but-retryable work `PENDING` until its next `availableAt`.
- After attempt `3`, move the raw delivery to a dead-letter queue with the raw
  event, error message, reason code, and attempt count.
- Manual replay should require deliberate inspection.

## Reason Codes

Stable reason codes:

- `APPLIED`
- `PARTIAL_MERGE`
- `DUPLICATE_EVENT`
- `INVALID_SCHEMA`
- `UNKNOWN_EVENT_TYPE`
- `ORDER_NOT_READY`
- `ORDER_ALREADY_EXISTS`
- `FORBIDDEN_TRANSITION`
- `OBSOLETE_EVENT`
- `OBSOLETE_FIELD`
- `NO_APPLICABLE_CHANGES`
- `PAYMENT_AMOUNT_REQUIRED`
- `PAYMENT_ALREADY_CAPTURED`
- `REFUND_AMOUNT_REQUIRED`
- `REFUND_EXCEEDS_CAPTURED`
- `PROCESSING_ERROR`
