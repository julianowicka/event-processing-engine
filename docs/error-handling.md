# Error Handling

The engine separates HTTP request errors from event-level business decisions.

## API-Level Errors

These errors reject the whole HTTP request:

- Request body is not a JSON array.
- SQLite database file cannot be opened, read, or written.

The API returns a standard NestJS error response with an appropriate HTTP status.

## Event-Level Decisions

These errors do not reject the ingestion request. They are recorded against the
individual processing job and raw delivery:

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
decision is `DEFERRED`, not `REJECTED`, and the job remains retryable. This
supports out-of-order delivery.

## Failure Safety

Ingestion and worker processing are separate SQLite transactions. The database
service commits only after a mutation completes successfully.

- If ingestion fails, no raw deliveries or processing jobs from that request are
  saved.
- If processing fails unexpectedly, the worker records the technical failure,
  schedules a retry, or moves the job to the DLQ after the retry limit.
- Worker failures update `event_processing_jobs`; they do not update
  `raw_incoming_events`.

Business decisions are final and are not retried. `DEFERRED` jobs are not
failures; they are retried after later ingestions.

## Retry And Dead Letter Policy

Implemented worker behavior:

- `DEFERRED` jobs are retried during later `POST /events` calls.
- A same-batch retry can also happen when a later event creates or changes the
  order needed by an earlier deferred event.
- Retry technical failures up to `3` attempts.
- Keep failed-but-retryable jobs `PENDING` until their next `available_at`.
- After attempt `3`, move the processing job to a dead-letter queue with the raw
  event snapshot, error message, reason code, and attempt count.
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
