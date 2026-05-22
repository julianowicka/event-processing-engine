# Error Handling

The engine separates API errors from event processing decisions.

## API-Level Errors

These errors reject the HTTP request:

- Request body is not a JSON array.
- Authentication fails after auth is enabled.
- SQLite is unavailable during ingestion.

The API returns a standard NestJS error response with a proper HTTP status code.

## Event-Level Errors

These errors do not reject the ingestion request. They are detected by the worker
and create an audit decision for the specific raw delivery:

- Missing `eventId`.
- Missing `orderId`.
- Unsupported event type.
- Invalid timestamp.
- Invalid payload shape.
- Forbidden state transition.
- Obsolete field update.
- Business rule conflict.

## Response Strategy

`POST /events` returns a queueing summary:

- `incomingEventId`.
- `jobId`.
- `eventId`.
- `orderId`.
- `status`: `QUEUED`.
- `message`.

## Failure Safety

If ingestion fails, the request transaction rolls back and no partial jobs are
created. If worker processing fails, the job transaction rolls back, the job is
marked as `FAILED` when possible, and a `FAILED` audit decision is written for
the raw delivery.

## Retry Policy

Jobs may be retried up to a small configured attempt limit. After the limit, the
job remains `FAILED` with a stable audit decision so it can be inspected or
manually replayed later.

## Reason Codes

Reason codes are stable and testable:

- `DUPLICATE_EVENT`
- `INVALID_SCHEMA`
- `UNKNOWN_EVENT_TYPE`
- `ORDER_NOT_FOUND`
- `FORBIDDEN_TRANSITION`
- `OBSOLETE_EVENT`
- `PARTIAL_MERGE`
- `PROCESSING_ERROR`
