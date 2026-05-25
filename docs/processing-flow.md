# Processing Flow

The implementation keeps asynchronous processing and uses the raw inbox row
itself as the durable work item.

## Phase 1: Ingestion

`POST /api/events` does as little as possible:

1. Validate that the request body is a JSON array.
2. Insert every item into `raw_incoming_events` in request order.
3. Store nullable `eventId`, `orderId`, `type`, and timestamp projections where
   they can be extracted.
4. Set `processing_status = PENDING`, `attempts = 0`, and `available_at` to the
   current time.
5. Commit and return `mode: "ASYNC_WORKER"`, one queued result per stored
   delivery, and `summary.queued`.

Malformed items are still stored. The input snapshot in `raw_event_json` is
never rewritten.

## Phase 2: Worker Processing

`EventProcessingSchedulerService` runs once on module initialization and then
on an interval. It selects rows with status `PENDING` or `RETRY`, orders them by
`event_timestamp ASC NULLS LAST` and then `id ASC`, filters out rows whose
`available_at` is still in the future, and processes the available rows one by
one. An in-process guard prevents overlapping scheduler ticks.

For each delivery:

1. Validate its raw JSON as an event.
2. Claim its valid `eventId` in `processed_event_keys`.
3. Write a final `DUPLICATE` decision immediately if the key is already held.
4. Read the current order state and apply state-transition and field-level
   timestamp rules.
5. Update `orders` and `order_field_versions` when fields are applied.
6. Write one final `event_decisions` row containing decision, reason, and any
   changed/skipped fields.
7. Increment the single `stats` row.
8. Mark the delivery as `DONE`.

Order history is the set of accepted or partially applied decisions; a separate
`order_history` write is not needed.

## Field-Level Merging

`order_field_versions` is deliberately retained:

- `ORDER_UPDATED` applies `amount` and `currency` only when the payload field's
  timestamp is newer than the timestamp stored for that field.
- A single delivery can therefore produce `PARTIALLY_APPLIED` when some fields
  are new and others are obsolete.
- Missing payload fields do not clear current values.
- `ORDER_UPDATED.payload.status` is never used for a lifecycle transition.
  Status transitions belong to creation, payment, cancellation, and refund
  events, so a supplied status is recorded as skipped.

This is the chosen strategy for stale partial updates on an existing order.

An event that requires an order and arrives before `ORDER_CREATED` is not given
a final audit decision immediately. It is marked `RETRY` with
`ORDER_NOT_READY`, becomes available after the configured retry delay, and is
finally rejected with `ORDER_NOT_READY` on the third unsuccessful attempt.

## Technical Retries

Only unexpected technical failures are retried.

1. Increment `raw_incoming_events.attempts`.
2. If attempts remain, set `processing_status = RETRY`, set `available_at` for
   10 seconds later, and save `last_error_message`.
3. If the retry limit is reached, set status to `DONE`, write a final `FAILED`
   audit decision, and update stats.

Retry attempts are not audit decisions because the engine has not made a final
business decision yet.

## Intentional Scope

The implementation supports one worker process. It does not include durable
worker lock ownership. Pending delivery lifecycle is still observable through
`GET /api/orders/:id` and the diagnostic `GET /api/events/:eventId` endpoint.
