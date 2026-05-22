# Event Processing Engine

NestJS service for ingesting order events, processing them asynchronously, and
exposing current order state, event history, and processing statistics.

The design favors deterministic behavior, auditability, and clear business
decisions over distributed infrastructure. Incoming events are stored first,
then processed by a worker backed by SQLite jobs.

## API

- `POST /events` queues a batch of raw event deliveries.
- `GET /orders/:id` returns current state, accepted history, and rejected events.
- `GET /stats` returns processed event counters and average processing time.
- `GET /health` returns basic service health.

## Run

```bash
yarn install
yarn start:dev
```

## Test

```bash
yarn test
yarn test:e2e
```

## Architecture Notes

Detailed design notes live in [docs/README.md](./docs/README.md). For production,
the SQLite worker could be replaced by a broker such as Kafka, SQS, Pub/Sub, or
EventBridge, with schema registry, dead-letter handling, tracing, and replay
tooling added around the same domain rules.
