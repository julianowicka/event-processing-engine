# Quality Plan

The solution prioritizes a working, deterministic core engine with readable
business rules.

## Code Structure

- `EventsController`: `POST /events`.
- `EventIngestionService`: phase 1 raw delivery storage and job creation.
- `EventWorkerService`: background polling and worker nudging.
- `EventProcessingService`: phase 2 processing orchestrator.
- `EventJobRepository`: processing job claiming, status, retry, and deferred
  job lifecycle.
- `OrderRepository` and `EventAuditRepository`: SQL persistence helpers for
  order state, deduplication, history, decisions, stats, and DLQ records.
- `EventValidationService`, `OrderStateMachineService`, `OrderMergeService`,
  and `EventDecisionService`: SQL-free processing rules and decision helpers.
- `OrdersController` and `OrdersService`: current state, history, and audit.
- `StatsController` and `StatsService`: counters and timing.
- `SqliteService`: SQLite persistence boundary.

## Maintainability Rules

- Keep controllers thin.
- Keep storage mechanics inside `SqliteService` and narrow persistence helpers.
- Keep raw delivery storage separate from processing job state.
- Keep state transitions outside controllers.
- Keep background-worker timing outside domain processing rules.
- Use stable string unions for event types, states, decisions, and reason codes.
- Treat payment/refund events as financial facts, not generic overwrites.
- Keep set-like merge rules separate from cumulative financial rules.

## Observability

Initial observability scope:

- Raw deliveries stored in the SQLite database.
- Processing lifecycle stored in `event_processing_jobs`.
- Engine decisions stored in `event_decisions`.
- Dead-lettered technical failures stored in `dead_letter_events`.
- Accepted changes stored in `order_history`.
- Stable reason codes.
- Processing time tracked per final decision and in aggregate stats.
- README examples.
