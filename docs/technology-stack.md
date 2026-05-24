# Technology Stack

The implementation favors a small, working MVP over infrastructure-heavy
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
- No ORM.
- No workflow engine.
- No event-sourcing framework.

## Processing

- Explicit phase 1 ingestion service.
- Inbox-style queue with immutable `raw_incoming_events` and mutable
  `event_processing_jobs`.
- In-process `EventWorkerService` for background processing.
- Worker interval defaults to `100` ms and can be changed with
  `EVENT_ENGINE_WORKER_INTERVAL_MS`.
- Deferred jobs for valid events that arrive before `ORDER_CREATED`.
- Technical failures retry up to `3` attempts, then move the job to
  `dead_letter_events`.

## Validation

- Lightweight TypeScript validation helpers.
- Request-level validation checks that `POST /events` receives an array.
- Event-level validation happens during processing and produces audit decisions.

## Testing

- Jest unit tests for processing behavior.
- The current tests cover worker-style processing, deferral retry,
  deduplication, partial merge, forbidden transitions, and DLQ handling.

## Optional Future Work

- Worker claiming/locking for multi-process deployments.
- API key guard if the API needs machine-to-machine protection.
