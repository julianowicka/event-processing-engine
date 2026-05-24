# Implementation Roadmap

The roadmap is scoped to a 6-10 hour recruitment implementation with a working
fragment preferred over an overbuilt design.

## Implemented MVP

- SQLite file persistence on disk.
- Append-only raw deliveries.
- Separate `event_processing_jobs` queue/status table.
- Materialized order state.
- History, audit decisions, deduplication keys, field versions, stats, and DLQ.
- Event-shape validation during worker processing.
- Deduplication by `eventId`.
- Explicit order status state machine.
- Field-level merge for set-like fields.
- Cumulative payment/refund behavior.
- Deferred events for out-of-order delivery before creation.
- `POST /events`: ingest and return `QUEUED`.
- Background worker: process available `PENDING` and `DEFERRED` jobs.
- Retry metadata and `dead_letter_events` for technical worker failures.
- `GET /orders/:id`: current state, history, rejected events, pending jobs,
  and audit log.
- `GET /stats`: required counters, timing, pending count, and DLQ count.
- `GET /health`: operational health endpoint.
- README with assumptions, run commands, and API examples.
- Focused Jest and e2e tests for critical business behavior.

## Later Enhancements

- Add worker claiming/locking for multi-process deployments.
- Add API key authentication, disabled by default for local evaluation.
- Add broader integration and performance tests.
