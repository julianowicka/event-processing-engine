# Quality Plan

The solution prioritizes a working, deterministic core engine with readable
business rules.

## Code Structure

- `EventsController`: `POST /events`.
- `EventIngestionService`: phase 1 raw delivery storage and initial lifecycle
  state.
- `EventWorkerService`: background polling and worker nudging.
- `EventProcessingService`: thin phase 2 orchestrator for validation,
  deduplication, dispatch, and completion delegation.
- `OrderEventStateMachineService`: explicit dispatcher from supported event
  type to one order event handler strategy.
- `OrderCreatedEventHandler`, `OrderUpdatedEventHandler`,
  `PaymentCapturedEventHandler`, `OrderCancelledEventHandler`, and
  `RefundIssuedEventHandler`: focused domain evaluation strategies.
- `EventDeliveryCompletionService`: applies evaluated outcomes and owns final,
  retry, and dead-letter completion effects.
- `EventDeliveryRepository`: stored-delivery status and retry lifecycle.
- `OrderRepository` and `EventAuditRepository`: SQL persistence helpers for
  order state, deduplication, history, decisions, stats, and DLQ records.
- `EventValidationService`, `OrderStatusTransitionRulesService`,
  `OrderUpdatedEventFieldsService`, and `EventDecisionService`: SQL-free
  processing rules and decision helpers shared by event handlers.
- `OrdersController` and `OrdersService`: current state, history, and audit.
- `StatsController` and `StatsService`: counters and timing.
- `SqliteService`: SQLite persistence boundary.

## Maintainability Rules

- Keep controllers thin.
- Keep storage mechanics inside `SqliteService` and narrow persistence helpers.
- Keep raw event snapshots immutable while updating only delivery lifecycle
  fields during processing.
- Keep state transitions outside controllers.
- Keep background-worker timing outside domain processing rules.
- Keep event handlers focused on evaluating outcomes; keep outcome persistence
  inside the completion service.
- Use stable string unions for event types, states, decisions, and reason codes.
- Treat payment/refund events as financial facts, not generic overwrites.
- Keep set-like merge rules separate from cumulative financial rules.

## Observability

Initial observability scope:

- Raw deliveries stored in the SQLite database.
- Processing lifecycle stored on `raw_incoming_events`.
- Engine decisions stored in `event_decisions`.
- Dead-lettered technical failures stored in `dead_letter_events`.
- Accepted changes queried from applied `event_decisions`.
- Stable reason codes.
- Processing time tracked per final decision and in aggregate stats.
- README examples.
