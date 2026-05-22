# API Contract

The API will be implemented with NestJS controllers and DTO validation.

## `POST /events`

Accepts a JSON array of events.

Request event shape:

```json
{
  "eventId": "evt-1001",
  "orderId": "ord-501",
  "type": "ORDER_UPDATED",
  "timestamp": 1710001000,
  "payload": {
    "status": "PAID",
    "amount": 199.99
  }
}
```

Response shape:

```json
{
  "results": [
    {
      "eventId": "evt-1001",
      "orderId": "ord-501",
      "decision": "ACCEPTED",
      "reasonCode": null,
      "message": "Event accepted"
    }
  ]
}
```

## `GET /orders/:id`

Returns:

- Current order state.
- Accepted history.
- Rejected, duplicate, and failed event decisions for this order.

## `GET /stats`

Returns:

- Valid events count.
- Rejected events count.
- Duplicate events count.
- Average processing time in milliseconds.

## `GET /health`

Returns service health for monitoring and deployment checks.

Response shape:

```json
{
  "status": "ok",
  "database": "ok",
  "timestamp": "2026-05-22T18:00:00.000Z"
}
```

This endpoint does not expose business data.

## Validation

DTO validation should reject malformed request containers at API level, while
malformed events inside a valid batch are handled as event-level decisions.
