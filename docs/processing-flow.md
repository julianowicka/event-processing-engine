# Processing Flow

`POST /events` is ingestion-only. Domain decisions are made by a background
worker running in the same Node.js process.

## Phase 1: Ingestion

1. Validate only that the request body is a JSON array.
2. Append every item to `rawIncomingEvents` in request order.
3. Extract nullable convenience fields such as `eventId`, `orderId`, `type`, and
   `eventTimestamp`.
4. Mark each delivery as `PENDING`, set `attempts` to `0`, and set `availableAt`.
5. Persist the JSON file.
6. Return `QUEUED` results.
7. Nudge the background worker.

Malformed event items are still stored. Event-level validation happens in the
worker and produces an audit decision.

## Phase 2: Background Worker

The worker runs on a short interval and can also be nudged after ingestion.

1. Read available `PENDING` and `DEFERRED` deliveries by `id ASC`.
2. Validate event shape and payload.
3. Claim the `eventId` deduplication key.
4. If the order does not exist and the event is not `ORDER_CREATED`, mark the
   event as `DEFERRED`.
5. Apply state-machine rules.
6. Apply field-level merge rules for set-like fields.
7. Apply cumulative payment/refund rules for financial facts.
8. Write order state, history, audit decision, and stats.
9. Mark final deliveries as `DONE`.

If a pass creates or changes an order, the worker runs another pass. This allows
an event that arrived before its `ORDER_CREATED` event to be retried after the
create event is processed.

## Retry And DLQ

Business decisions are final and are not retried. `DEFERRED` events are retried
when the worker runs again.

Unexpected technical failures are retried up to `3` attempts. Failed deliveries
stay `PENDING` until their next `availableAt`. After the third technical failure,
the delivery is marked `DEAD_LETTERED`, a `FAILED` audit decision is written,
and a record is stored in `deadLetterEvents`.

## Determinism

Processing order is raw delivery `id ASC`. Event timestamps do not define
processing order; they define conflict behavior inside merge rules.
