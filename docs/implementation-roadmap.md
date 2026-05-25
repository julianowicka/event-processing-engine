# Implementation Notes

This file records what the current implementation includes and what remains a
later enhancement.

## Implemented MVP

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
- Missing-order events retried and then rejected; stale fields for existing
  orders merged.
- `POST /api/events`: ingest and return queued delivery results.
- Background worker: process available `PENDING` and `RETRY` deliveries.
- Retry metadata and final failed decisions for technical worker failures.
- `GET /api/orders/:id`: current state, history, rejected events, and audit log.
- `GET /api/stats`: required counters and processing time.
- `GET /api/health`: operational health endpoint.
- README with assumptions, run commands, and API examples.
- Focused Jest and e2e tests for critical business behavior.

## Later Enhancements

- Add worker claiming/locking for multi-process deployments.
- Add API key authentication, disabled by default for local evaluation.
- Add broader integration and performance tests.
