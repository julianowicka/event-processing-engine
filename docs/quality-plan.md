# Quality Plan

The solution is easy to read, deterministic, and testable.

## Code Structure

NestJS modules:

- `EventsModule`: API endpoint and batch orchestration.
- `EventProcessingModule`: worker orchestration and job processing.
- `OrdersModule`: current state queries.
- `StatsModule`: aggregate counters.
- `DatabaseModule`: TypeORM DataSource and SQLite migrations.
- `AuthModule`: API key guard added near the end.

## Domain Services

- `EventProcessor`: coordinates one job transaction.
- `EventJobWorker`: claims and processes pending jobs.
- `EventIngestionService`: stores raw deliveries and creates jobs.
- `EventValidator`: validates event shape and business prerequisites.
- `StateMachine`: owns status transitions.
- `MergeService`: owns field-level merge decisions.
- `AuditService`: writes decisions and history.
- `HealthService`: checks application and database readiness.

## Maintainability Rules

- Keep controllers thin.
- Keep TypeORM usage inside persistence boundaries.
- Keep state transition logic outside controllers.
- Keep state transition logic outside entities.
- Use stable enums for event types, states, decisions, and reason codes.
- Test business rules without HTTP whenever possible.

## Observability

Initial observability scope:

- Structured audit decisions in SQLite.
- Append-only raw event deliveries in SQLite.
- Job status tracking for asynchronous processing.
- Stable reason codes.
- Processing time tracked per event and in aggregate stats.
- Clear README examples.
