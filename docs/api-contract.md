# API Contract

The API is asynchronous from the caller's perspective. `POST /events` stores raw
deliveries and returns a queued response. A background worker then processes
available deliveries in raw delivery order.

## Business Endpoints

- `POST /events`
- `GET /orders/:id`
- `GET /stats`

`GET /health` is operational and not part of the recruitment business contract.

## `POST /events`

Accepts a JSON array of event objects. The endpoint stores every item as a raw
delivery, including malformed items, then asks the background worker to process
available work.

Request example:

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
  },
  {
    "eventId": "evt-1002",
    "orderId": "ord-501",
    "type": "PAYMENT_CAPTURED",
    "timestamp": 1710001000,
    "payload": {
      "amount": 199.99
    }
  }
]
```

Response example:

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
      "reasonMessage": "Event queued for background processing",
      "processingTimeMs": 0
    },
    {
      "incomingEventId": 2,
      "eventId": "evt-1002",
      "orderId": "ord-501",
      "type": "PAYMENT_CAPTURED",
      "status": "QUEUED",
      "reasonCode": null,
      "reasonMessage": "Event queued for background processing",
      "processingTimeMs": 0
    }
  ],
  "summary": {
    "queued": 2
  }
}
```

Final processing decisions are visible through `GET /orders/:id`, `GET /stats`,
and the JSON database after the worker runs.

## Worker Decisions

- `ACCEPTED`: the event changed order state.
- `PARTIALLY_APPLIED`: at least one field was applied and at least one obsolete
  field was skipped.
- `REJECTED`: the event is final and did not change state.
- `DUPLICATE`: the `eventId` was already seen by a different raw delivery.
- `DEFERRED`: the event needs an order that does not exist yet and will be
  retried later.
- `FAILED`: a technical processing failure exhausted retries and moved to DLQ.

## `GET /orders/:id`

Returns current state, accepted history, rejected/duplicate/failed decisions,
pending decisions, and the complete audit log for the order.

Unknown orders return `404` unless there is audit information for that order.

## `GET /stats`

Returns the required counters plus diagnostic counters.

```json
{
  "validEventsCount": 120,
  "rejectedEventsCount": 8,
  "duplicateEventsCount": 3,
  "averageProcessingTimeMs": 4.7,
  "acceptedEventsCount": 115,
  "partiallyAppliedEventsCount": 5,
  "processedEventsCount": 131,
  "pendingEventsCount": 0,
  "deadLetterEventsCount": 0
}
```

Deferred events are not counted as rejected. Dead-lettered technical failures are
counted as rejected.

## `GET /health`

```json
{
  "status": "ok",
  "database": "ok",
  "timestamp": "2026-05-22T18:00:00.000Z"
}
```

## Event Payload Rules

- Money fields are accepted as decimals and stored as integer minor units.
- `ORDER_CREATED` creates an order in `CREATED` status and may include `amount`
  and `currency`.
- `ORDER_UPDATED` may update `amount`, `currency`, and optionally request a
  status transition through `payload.status`.
- `PAYMENT_CAPTURED` captures one payment and moves `CREATED -> PAID`.
- `ORDER_CANCELLED` moves `CREATED -> CANCELLED`.
- `REFUND_ISSUED` uses `amount` or `refundAmount` as a refund delta and moves a
  paid order to `PARTIALLY_REFUNDED` or `REFUNDED`.
