# API Contract

This document describes the contract implemented by the current code.

The API is asynchronous from the caller's perspective: `POST /api/events` stores
raw deliveries and returns immediately, and a background worker later records
decisions and updates order state.

## Implemented Endpoints

- `POST /api/events`
- `GET /api/events/:eventId`
- `GET /api/orders/:id`
- `GET /api/stats`
- `GET /api/health`

## `POST /api/events`

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
  "mode": "ASYNC_WORKER",
  "results": [
    {
      "incomingEventId": 1,
      "eventId": "evt-1001",
      "orderId": "ord-501",
      "type": "ORDER_CREATED",
      "status": "QUEUED",
      "reasonCode": null,
      "reasonMessage": "Queued for asynchronous processing",
      "processingTimeMs": 0
    }
  ],
  "summary": {
    "queued": 1
  }
}
```

If the request body is not an array, the controller rejects the whole request
with a standard NestJS `400` response.

The API is eventually consistent. A successful `POST /api/events` confirms
durable acceptance for later processing; `GET /api/orders/:id` and
`GET /api/stats` reflect only deliveries already finalized by the background
scheduler.

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

## `GET /api/orders/:id`

After an order creation has been finalized, the endpoint returns the
information requested by the assignment:

```json
{
  "orderId": "ord-501",
  "status": "CREATED",
  "amount": 199.99,
  "currency": "PLN",
  "paidAmount": 0,
  "refundedAmount": 0,
  "createdAt": "2026-01-01T12:00:00.000Z",
  "updatedAt": "2026-01-01T12:00:00.000Z",
  "history": [
    {
      "id": 1,
      "eventId": "evt-1001",
      "type": "ORDER_CREATED",
      "timestamp": 1710000900,
      "processedAt": "2026-01-01T12:00:00.000Z",
      "fromStatus": null,
      "toStatus": "CREATED",
      "decision": "ACCEPTED",
      "reasonCode": "APPLIED",
      "changedFields": {
        "status": "CREATED",
        "amount": 199.99,
        "currency": "PLN"
      },
      "skippedFields": {},
      "createdAt": "2026-01-01T12:00:00.000Z"
    }
  ],
  "rejectedEvents": [],
  "pendingJobs": [],
  "auditLog": [
    {
      "id": 1,
      "rawIncomingEventId": 1,
      "eventId": "evt-1001",
      "orderId": "ord-501",
      "type": "ORDER_CREATED",
      "timestamp": 1710000900,
      "decision": "ACCEPTED",
      "reasonCode": "APPLIED",
      "reasonMessage": "Event was applied",
      "fromStatus": null,
      "toStatus": "CREATED",
      "changedFields": {
        "status": "CREATED",
        "amount": 199.99,
        "currency": "PLN"
      },
      "skippedFields": {},
      "processingTimeMs": 1,
      "createdAt": "2026-01-01T12:00:00.000Z"
    }
  ]
}
```

History is produced from `event_decisions` rows with decision `ACCEPTED` or
`PARTIALLY_APPLIED`; there is no separate history table.

Rejected events include `REJECTED`, `DUPLICATE`, and `FAILED` decisions with
their reason codes and messages. `pendingJobs` contains raw deliveries for the
same `orderId` that are still `PENDING` or `RETRY`.

When deliveries exist but no order has been materialized yet, the endpoint
returns the available activity without root-level state fields:

```json
{
  "orderId": "ord-501",
  "history": [],
  "rejectedEvents": [],
  "pendingJobs": [
    {
      "id": 2,
      "rawIncomingEventId": 2,
      "status": "RETRY",
      "availableAt": "2026-01-01T12:00:10.000Z",
      "attempts": 1,
      "lastErrorMessage": "Event requires an existing order",
      "eventId": "evt-1002",
      "orderId": "ord-501",
      "type": "PAYMENT_CAPTURED",
      "timestamp": 1710001000,
      "receivedAt": "2026-01-01T12:00:00.000Z"
    }
  ],
  "auditLog": []
}
```

If the order has no state, no audit decisions, and no pending jobs, the
endpoint returns `404`.

## `GET /api/events/:eventId`

This diagnostic endpoint is used by the bundled frontend. It returns all raw
deliveries with the requested external `eventId`, their processing lifecycle,
final decisions, and history entries derived from accepted or partially applied
decisions. It returns `404` when no raw delivery has that `eventId`.

## `GET /api/stats`

Returns exactly the four required precomputed statistics:

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
- No queue state, raw delivery count, aggregate processed count, or update
  timestamp is exposed by this endpoint.

## Event And Ordering Rules

- Money fields are stored as integer minor units and mapped to major-unit
  `amount`, `paidAmount`, and `refundedAmount` fields only when returned by the
  API.
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
  attempts, scheduled 10 seconds apart, before final rejection.
