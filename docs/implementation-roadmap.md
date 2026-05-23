# Implementation Roadmap

The roadmap is scoped to a 6-10 hour recruitment implementation with a working
fragment preferred over an overbuilt design.

## Implemented MVP

- JSON file persistence on disk.
- Append-only raw deliveries.
- Materialized order state.
- History, audit decisions, deduplication keys, field versions, stats, and DLQ.
- Event-shape validation during worker processing.
- Deduplication by `eventId`.
- Explicit order status state machine.
- Field-level merge for set-like fields.
- Cumulative payment/refund behavior.
- Deferred events for out-of-order delivery before creation.
- `POST /events`: ingest and return `QUEUED`.
- Background worker: process available `PENDING` and `DEFERRED` deliveries.
- Retry metadata and `deadLetterEvents` for technical worker failures.
- `GET /orders/:id`: current state, history, rejected events, pending events,
  and audit log.
- `GET /stats`: required counters, timing, pending count, and DLQ count.
- `GET /health`: operational health endpoint.
- README with assumptions, run commands, and API examples.
- Focused Jest and e2e tests for critical business behavior.

## Later Enhancements

- Replace JSON file with SQLite for concurrent writes.
- Add worker claiming/locking for multi-process deployments.
- Add API key authentication, disabled by default for local evaluation.
- Add broader integration and performance tests.
