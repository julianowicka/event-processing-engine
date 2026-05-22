# API Contract

The API will be implemented with NestJS controllers and minimal ingestion validation.

The business API implements the required contract:

- `POST /events`
- `GET /orders/:id`
- `GET /stats`

## `POST /events`

Accepts a batch of events as a JSON array and queues them for asynchronous processing.
The endpoint stores raw deliveries in the order received and creates processing
jobs. It does not apply business decisions synchronously.

Request shape:

```json
[
  {
    "eventId": "evt-1001",
    "orderId": "ord-501",
    "type": "ORDER_UPDATED",
    "timestamp": 1710001000,
    "payload": {
      "status": "PAID",
      "amount": 199.99,
      "currency": "PLN"
    }
  }
]
```

The public API accepts money as decimal amounts. The processing layer converts
money to integer minor units before persistence.

Response shape:

```json
{
  "results": [
    {
      "incomingEventId": 101,
      "jobId": 501,
      "eventId": "evt-1001",
      "orderId": "ord-501",
      "status": "QUEUED",
      "message": "Event queued for processing"
    }
  ]
}
```

## `GET /orders/:id`

Returns:

- Current order state.
- Accepted history.
- Rejected, duplicate, and failed event decisions for this order.

Queued events that have not been processed yet are not included in this response.

Example response:

```json
{
  "currentState": {
    "orderId": "ord-501",
    "status": "PAID",
    "amountMinor": 19999,
    "currency": "PLN",
    "paidAmountMinor": 19999,
    "refundedAmountMinor": 0,
    "lastAcceptedEventTimestamp": 1710001000
  },
  "history": [
    {
      "eventId": "evt-1001",
      "eventTimestamp": 1710001000,
      "processedAt": "2026-05-22T18:00:00.000Z",
      "fromStatus": "CREATED",
      "toStatus": "PAID",
      "changedFields": {
        "paidAmountMinor": 19999
      }
    }
  ],
  "rejectedEvents": [
    {
      "eventId": "evt-1002",
      "type": "PAYMENT_CAPTURED",
      "timestamp": 1710000900,
      "decision": "REJECTED",
      "reasonCode": "FORBIDDEN_TRANSITION",
      "reasonMessage": "Payment cannot be captured for a cancelled order"
    },
    {
      "eventId": "evt-1001",
      "type": "ORDER_UPDATED",
      "timestamp": 1710001000,
      "decision": "DUPLICATE",
      "reasonCode": "DUPLICATE_EVENT",
      "reasonMessage": "Event was already processed"
    }
  ]
}
```

## `GET /stats`

Returns:

- Valid events count.
- Rejected events count.
- Duplicate events count.
- Average processing time in milliseconds.

Stats are calculated from processed jobs only. Queued jobs are not included.

Response shape:

```json
{
  "validEventsCount": 120,
  "rejectedEventsCount": 8,
  "duplicateEventsCount": 3,
  "averageProcessingTimeMs": 4.7
}
```

## Operational Endpoint: `GET /health`

Returns service health for monitoring and deployment checks. This endpoint is
operational and is not part of the business API contract.

Response shape:

```json
{
  "status": "ok",
  "database": "ok",
  "timestamp": "2026-05-22T18:00:00.000Z"
}
```

This endpoint does not expose business data.

## Ingestion Validation

`POST /events` validates only the request container. The body must be a JSON
array.

Items inside the array are accepted as raw deliveries whenever they can be stored
as JSON, even if they are malformed, incomplete, or have unsupported fields.
