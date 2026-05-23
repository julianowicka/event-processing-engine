# Quality Plan

The solution prioritizes a working, deterministic core engine with readable
business rules.

## Code Structure

- `EventsController`: `POST /events`.
- `EventIngestionService`: phase 1 raw delivery storage.
- `EventWorkerService`: background polling and worker nudging.
- `EventProcessingService`: phase 2 domain processing.
- `OrdersController` and `OrdersService`: current state, history, and audit.
- `StatsController` and `StatsService`: counters and timing.
- `JsonDatabaseService`: JSON-file persistence boundary.
- `StateMachineService`: status transition rules.

## Maintainability Rules

- Keep controllers thin.
- Keep storage mechanics inside `JsonDatabaseService`.
- Keep state transitions outside controllers.
- Keep background-worker timing outside domain processing rules.
- Use stable string unions for event types, states, decisions, and reason codes.
- Treat payment/refund events as financial facts, not generic overwrites.
- Keep set-like merge rules separate from cumulative financial rules.

## Observability

Initial observability scope:

- Raw deliveries stored in the JSON database.
- Engine decisions stored in `eventDecisions`.
- Dead-lettered technical failures stored in `deadLetterEvents`.
- Accepted changes stored in `orderHistory`.
- Stable reason codes.
- Processing time tracked per final decision and in aggregate stats.
- README examples.
