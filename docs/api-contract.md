# API Contract - Simplified Target Design

This document describes the target contract for the recruitment-task version.

The API is asynchronous from the caller's perspective: `POST /events` stores
raw deliveries and returns immediately, and a background worker later records
decisions and updates order state.

## Required Endpoints

- `POST /events`
- `GET /orders/:id`
- `GET /stats`

Operational endpoints such as `GET /health` may remain, but diagnostic event
inspection and processing-lifecycle output are outside the recruitment-task
scope.

## `POST /events`

Accepts a JSON array. Every array item is persisted in `raw_incoming_events`,
including malformed items and duplicate deliveries. Validation and business
decisions happen later in the worker.

Request:

```json
[
  {
    "eventId": "evt-1001",
    "orderId": "ord-501",
    "type": "ORDER_CREATED",
    "timestamp": 1710000900,
    "payload": {
      "amount": 199.99,
      "currency": "PLN"
    }
  }
]
```

Response:

```json
{
  "received": 1,
  "incomingEventIds": [1]
}
```

The API does not expose internal processing lifecycle fields because they
belong to each stored delivery in the simplified schema.

The API is eventually consistent. A successful `POST /events` confirms durable
acceptance for later processing; `GET /orders/:id` and `GET /stats` reflect only
deliveries already finalized by the background worker.

## Worker Decisions

Every delivery eventually receives one final audit decision:

- `ACCEPTED`: the event changed the order state.
- `PARTIALLY_APPLIED`: some fields were applied and stale or forbidden fields
  were skipped.
- `REJECTED`: the event was valid enough to evaluate but cannot be applied, or
  its schema/type is invalid.
- `DUPLICATE`: a valid `eventId` was already claimed.
- `FAILED`: unexpected processing errors exhausted the technical retry limit.

Retries before the final result are lifecycle metadata, not audit decisions.

## `GET /orders/:id`

After an order creation and a payment delivery have been finalized, the
endpoint returns the information requested by the assignment:

```json
{
  "orderId": "ord-501",
  "currentState": {
    "status": "PAID",
    "amountMinor": 19999,
    "currency": "PLN",
    "paidAmountMinor": 19999,
    "refundedAmountMinor": 0
  },
  "history": [
    {
      "eventId": "evt-1001",
      "decision": "ACCEPTED",
      "changedFields": {
        "status": "CREATED",
        "amountMinor": 19999,
        "currency": "PLN"
      }
    },
    {
      "eventId": "evt-1002",
      "decision": "ACCEPTED",
      "changedFields": {
        "status": "PAID",
        "paidAmountMinor": 19999
      }
    }
  ],
  "rejectedEvents": [],
  "auditLog": []
}
```

History is produced from `event_decisions` rows with decision `ACCEPTED` or
`PARTIALLY_APPLIED`; there is no separate history table.

Rejected events include `REJECTED`, `DUPLICATE`, and `FAILED` decisions with
their reason codes and messages. The full audit log may be returned as a useful
addition to the minimum assignment response.

Pending delivery state and retry information are intentionally not part of this
business endpoint.

## `GET /stats`

Returns the required precomputed statistics:

```json
{
  "validEventsCount": 120,
  "rejectedEventsCount": 8,
  "duplicateEventsCount": 3,
  "averageProcessingTimeMs": 4.7
}
```

- Valid events are `ACCEPTED` plus `PARTIALLY_APPLIED`.
- Rejected events are `REJECTED` plus exhausted technical failures reported as
  `FAILED`.
- Duplicate events are counted separately.
- Average processing time is computed from the stored total and final processed
  count.

## Event And Ordering Rules

- Money fields are stored as integer minor units.
- `ORDER_CREATED` creates an order in `CREATED` status.
- `ORDER_UPDATED` modifies only supplied non-lifecycle fields, currently
  `amount` and `currency`.
- Field-level timestamp metadata allows newer fields from an otherwise stale
  event to be applied while obsolete fields are skipped.
- `PAYMENT_CAPTURED` and `REFUND_ISSUED` are validated business operations.
- Forbidden transitions such as `CANCELLED -> PAID` are rejected.
- Lifecycle status is derived from `ORDER_CREATED`, `PAYMENT_CAPTURED`,
  `ORDER_CANCELLED`, and `REFUND_ISSUED`. A `status` supplied in an
  `ORDER_UPDATED` payload is not applied; any applicable descriptive fields
  from the same event may still be partially applied and the skipped status is
  recorded in the audit decision.
- An event that requires a missing order stays retryable for up to three
  attempts, scheduled 5 seconds apart, before final rejection.
