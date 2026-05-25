# Processing Flow - Simplified Target Design

This target keeps asynchronous processing and uses the raw inbox row itself as
the durable work item.

## Phase 1: Ingestion

`POST /events` does as little as possible:

1. Validate that the request body is a JSON array.
2. Insert every item into `raw_incoming_events` in request order.
3. Store nullable `eventId`, `orderId`, `type`, and timestamp projections where
   they can be extracted.
4. Set `processing_status = PENDING`, `attempts = 0`, and `available_at` to the
   current time.
5. Commit and return the stored delivery ids.

Malformed items are still stored. The input snapshot in `raw_event_json` is
never rewritten.

## Phase 2: Worker Processing

A single background worker selects the next row with status `PENDING` or
`RETRY` whose `available_at` has arrived, ordered by delivery id.

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

An event that cannot be evaluated because its order does not yet exist is
rejected with an explicit reason. The simplified target does not retry business
ordering cases such as payment arriving before order creation.

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

The simplified target supports one worker process. It does not include worker
lock ownership, pending-delivery API output, or business deferral. These
features are outside the recruitment-task requirements and can be added later
if needed.
