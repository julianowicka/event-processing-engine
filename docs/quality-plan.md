# Quality Plan

The solution prioritizes a working, deterministic core engine with readable
business rules.

## Code Structure

- `EventsController`: `POST /api/events`.
- `EventEnqueuerService`: phase 1 raw delivery storage and initial lifecycle
  state.
- `RawEventsFactory`: raw delivery projections and queued response records.
- `EventProcessingSchedulerService`: background polling, availability
  filtering, and in-process overlap guard.
- `EventProcessingService`: thin phase 2 orchestrator for validation,
  deduplication, current-status handler dispatch, and retry handling.
- `OrderEventHandlerFactory`: discovers handlers by current order status.
- `NonExistentOrderEventHandler`, `OrderCreatedEventHandler`,
  `OrderPaidEventHandler`, `OrderCancelledEventHandler`,
  `OrderPartiallyRefundedEventHandler`, and `OrderRefundedEventHandler`:
  status-specific event routing.
- `OrderCreationApplicationService`, `OrderUpdateApplicationService`,
  `OrderLifecycleApplicationService`, and `OrderStateApplicationService`:
  domain mutations and transition decisions.
- `EventDecisionWriterService`: owns final decisions, retry lifecycle updates,
  and stats increments.
- `RawIncomingEventRepository`, `ProcessedEventKeyRepository`,
  `OrderRepository`, `OrderFieldVersionRepository`,
  `EventDecisionRepository`, and `EngineStatsRepository`: TypeORM-backed
  persistence helpers where used.
- `EventValidationService`, `EventMoneyService`, `OrderPayloadReaderService`,
  `OrderFieldVersionService`, and `OrderApplicationDecisionService`:
  processing rules and decision helpers shared by handlers.
- `OrdersController` and `OrdersService`: current state, history, and audit.
- `StatsController` and `StatsService`: counters and timing.
- `EventInspectorService`: diagnostic raw delivery, decision, and history
  inspection for the frontend.
- `DatabaseService`: TypeORM data source and transaction boundary.

## Maintainability Rules

- Keep controllers thin.
- Keep storage mechanics inside TypeORM repositories, entities, and
  `DatabaseService`.
- Keep raw event snapshots immutable while updating only delivery lifecycle
  fields during processing.
- Keep state transitions outside controllers.
- Keep background-worker timing outside domain processing rules.
- Keep status handlers focused on routing; keep final decision persistence
  inside `EventDecisionWriterService`.
- Use stable string unions for event types, states, decisions, and reason codes.
- Treat payment/refund events as financial facts, not generic overwrites.
- Keep set-like merge rules separate from cumulative financial rules.

## Observability

Initial observability scope:

- Raw deliveries stored in the SQLite database.
- Processing lifecycle stored on `raw_incoming_events`.
- Engine decisions stored in `event_decisions`.
- Exhausted technical failures stored as final `FAILED` decisions.
- Accepted changes queried from applied `event_decisions`.
- Stable reason codes.
- Processing time tracked per final decision and in aggregate stats.
- README examples.
