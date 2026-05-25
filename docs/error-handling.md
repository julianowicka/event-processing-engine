# Error Handling

The engine separates HTTP request errors from event-level business decisions.

## API-Level Errors

These errors reject the whole HTTP request:

- Request body is not a JSON array.
- SQLite database file cannot be opened, read, or written.

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
- Lifecycle status supplied through `ORDER_UPDATED`.
- Duplicate `eventId`.
- Refund greater than captured payment.

## Missing Order

If an otherwise valid event references an order that does not exist yet, it is
kept in `RETRY` and made available one hour later. After three unsuccessful
attempts, the final decision is `REJECTED` with reason `ORDER_NOT_READY`.

## Failure Safety

Ingestion and worker processing are separate SQLite transactions. The database
service commits only after a mutation completes successfully.

- If ingestion fails, no raw deliveries from that request are saved.
- If processing fails unexpectedly, the worker records the technical failure,
  schedules a retry, or moves the delivery to the DLQ after the retry limit.
- Worker failures update only processing lifecycle fields on
  `raw_incoming_events`; its `raw_event_json` snapshot is immutable.

Business decisions are final except for `ORDER_NOT_READY`, which is explicitly
retryable because order creation may still arrive.

## Retry And Dead Letter Policy

Target worker behavior:

- Retry `ORDER_NOT_READY` one hour later and reject it on attempt `3`.
- Retry technical failures up to `3` attempts.
- Keep failed-but-retryable deliveries `RETRY` until their next `available_at`.
- After attempt `3`, move the delivery to a dead-letter queue with an error
  message; its raw event snapshot and attempt count remain available from
  `raw_incoming_events`.
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
- `STATUS_REQUIRES_DOMAIN_EVENT`
- `OBSOLETE_EVENT`
- `OBSOLETE_FIELD`
- `NO_APPLICABLE_CHANGES`
- `PAYMENT_AMOUNT_REQUIRED`
- `PAYMENT_ALREADY_CAPTURED`
- `REFUND_AMOUNT_REQUIRED`
- `REFUND_EXCEEDS_CAPTURED`
- `PROCESSING_ERROR`
