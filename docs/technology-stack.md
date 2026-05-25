# Technology Stack

The target design favors a small, working MVP over infrastructure-heavy
architecture.

## Runtime

- Node.js.
- TypeScript.
- Yarn-compatible project with `yarn.lock` v1.

## HTTP Framework

- NestJS 11.
- `@nestjs/platform-express` HTTP adapter.
- Thin controllers with business logic in services.

## Persistence

- Local SQLite database file stored on disk.
- Default path: `data/app.sqlite`.
- Optional override: `SQLITE_DB_PATH`.
- TypeORM migrations with schema synchronization disabled.
- No workflow engine.
- No event-sourcing framework.

## Processing

- Explicit phase 1 ingestion service.
- Inbox-style queue with immutable raw JSON and mutable lifecycle fields on
  `raw_incoming_events`.
- In-process `EventWorkerService` for background processing.
- Worker interval defaults to `100` ms and can be changed with
  `EVENT_PROCESSING_SCHEDULER_INTERVAL_MS`.
- Events requiring a missing order retry after 10 seconds and are rejected with
  `ORDER_NOT_READY` after three unsuccessful attempts.
- Technical failures retry after 10 seconds, up to `3` attempts, then produce
  a final `FAILED` decision.
- `EVENT_RETRY_DELAY_MS` configures the shared retry delay for both cases;
  Docker Compose deployments set it to `10000` ms.

## Validation

- Lightweight TypeScript validation helpers.
- Request-level validation checks that `POST /events` receives an array.
- Event-level validation happens during processing and produces audit decisions.

## Testing

- Jest unit tests for processing behavior.
- Target tests cover worker-style processing, missing-order rejection,
  deduplication, partial merge, domain-owned status transitions, and technical
  failure handling.

## Optional Future Work

- Worker claiming/locking for multi-process deployments.
- API key guard if the API needs machine-to-machine protection.
