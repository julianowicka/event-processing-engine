# Event Processing Engine

NestJS + TypeScript implementation of the order event processing recruitment
task.

The API queues event batches and a background worker processes them shortly
after ingestion. This mirrors asynchronous integrations while keeping the
project small enough for local recruitment-task evaluation.

## Requirements

- Node.js
- Yarn Classic

The project uses a JSON file database on disk. By default it writes to
`data/events-db.json`. You can override this path with `EVENT_ENGINE_DB_FILE`.

The worker runs in the same Node.js process. Its polling interval defaults to
100 ms and can be changed with `EVENT_ENGINE_WORKER_INTERVAL_MS`.

## Install

```bash
yarn install
```

## Run

```bash
yarn start:dev
```

The app listens on `http://localhost:3000` unless `PORT` is set.

## Test

```bash
yarn test
yarn build
```

## API

### `POST /events`

```bash
curl -X POST http://localhost:3000/events \
  -H "Content-Type: application/json" \
  -d '[
    {
      "eventId": "evt-1001",
      "orderId": "ord-501",
      "type": "ORDER_CREATED",
      "timestamp": 1710000900,
      "payload": { "amount": 199.99, "currency": "PLN" }
    },
    {
      "eventId": "evt-1002",
      "orderId": "ord-501",
      "type": "PAYMENT_CAPTURED",
      "timestamp": 1710001000,
      "payload": { "amount": 199.99 }
    }
  ]'
```

### `GET /orders/:id`

```bash
curl http://localhost:3000/orders/ord-501
```

Returns current state, history, rejected/duplicate events, pending events, and
the full audit log for the order.

### `GET /stats`

```bash
curl http://localhost:3000/stats
```

Returns valid, rejected, duplicate, and average processing-time counters, plus a
few diagnostic counters.

### `GET /health`

```bash
curl http://localhost:3000/health
```

## Business Rules

- Duplicate `eventId` deliveries are ignored and audited as `DUPLICATE`.
- Events for unknown orders are `DEFERRED`, then retried after later ingestions.
- Technical worker failures are retried up to 3 times, then moved to the DLQ.
- `ORDER_CREATED` creates `CREATED` orders.
- `PAYMENT_CAPTURED` moves `CREATED -> PAID`.
- `ORDER_CANCELLED` moves `CREATED -> CANCELLED`.
- `REFUND_ISSUED` adds a refund amount and moves paid orders to
  `PARTIALLY_REFUNDED` or `REFUNDED`.
- `ORDER_UPDATED` can update `amount`, `currency`, and optionally request a
  valid `payload.status` transition.
- Set-like fields use strict newer-timestamp wins. Same timestamp keeps the
  first accepted value.
- Missing fields never erase existing state.

More detail is in [docs/README.md](./docs/README.md).
