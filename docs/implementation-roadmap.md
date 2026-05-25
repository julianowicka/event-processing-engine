# Implementation Roadmap

The roadmap is scoped to a 6-10 hour recruitment implementation with a working
fragment preferred over an overbuilt design.

## Target MVP

- SQLite file persistence on disk.
- Immutable raw event snapshots with processing lifecycle metadata on
  `raw_incoming_events`.
- Materialized order state.
- History from applied audit decisions, deduplication keys, field versions, and
  stats.
- Event-shape validation during worker processing.
- Deduplication by `eventId`.
- Explicit order status state machine.
- Field-level merge for set-like fields.
- Cumulative payment/refund behavior.
- Lifecycle status transitions owned by domain events, not `ORDER_UPDATED`.
- Missing-order events rejected; stale fields for existing orders merged.
- `POST /events`: ingest and return stored delivery ids.
- Background worker: process available `PENDING` and `RETRY` deliveries.
- Retry metadata and final failed decisions for technical worker failures.
- `GET /orders/:id`: current state, history, rejected events, and audit log.
- `GET /stats`: required counters and processing time.
- `GET /health`: operational health endpoint.
- README with assumptions, run commands, and API examples.
- Focused Jest and e2e tests for critical business behavior.

## Later Enhancements

- Add worker claiming/locking for multi-process deployments.
- Add API key authentication, disabled by default for local evaluation.
- Add broader integration and performance tests.
