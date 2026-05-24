# Processing Flow

`POST /events` is ingestion-only. It writes immutable raw deliveries and creates
processing jobs. Domain decisions are made later by a background worker running
in the same Node.js process.

## Phase 1: Ingestion

1. Validate only that the request body is a JSON array.
2. Append every item to `raw_incoming_events` in request order.
3. Extract nullable convenience fields such as `eventId`, `orderId`, `type`, and
   `eventTimestamp`.
4. Create one `event_processing_jobs` row per raw delivery.
5. Mark each job as `PENDING`, set `attempts` to `0`, and set `available_at`.
6. Commit the SQLite transaction.
7. Return `QUEUED` results.
8. Nudge the background worker.

Malformed event items are still stored. Event-level validation happens in the
worker and produces an audit decision. The worker updates
`event_processing_jobs`; it must not update `raw_incoming_events`.

## Phase 2: Background Worker

The worker runs on a short interval and can also be nudged after ingestion.

1. Read available `PENDING` and `DEFERRED` jobs from `event_processing_jobs`,
   joined to `raw_incoming_events`, in raw delivery `id ASC` order.
2. Validate event shape and payload.
3. Claim the `eventId` deduplication key. If the key is already claimed, write a
   `DUPLICATE` decision and mark the job as `DONE`.
4. If the order does not exist and the event is not `ORDER_CREATED`, write a
   `DEFERRED` audit decision and mark the job as `DEFERRED`.
5. Apply state-machine rules.
6. Apply field-level merge rules for set-like fields.
7. Apply cumulative payment/refund rules for financial facts.
8. Write order state, history, audit decision, and stats.
9. Mark final jobs as `DONE`.

If a pass creates or changes an order, the worker runs another pass. This allows
an event that arrived before its `ORDER_CREATED` event to be retried after the
create event is processed.

## Retry And DLQ

Business decisions are final and are not retried. `DEFERRED` jobs are retried
when the worker runs again.

Unexpected technical failures are retried up to `3` attempts. Failed jobs stay
`PENDING` until their next `available_at`. After the third technical failure,
the job is marked `DEAD_LETTERED`, a `FAILED` audit decision is written, and a
record is stored in `dead_letter_events`.

## Determinism

Processing order is raw delivery `id ASC`, even though the worker reads through
`event_processing_jobs`. Event timestamps do not define processing order; they
define conflict behavior inside merge rules.
