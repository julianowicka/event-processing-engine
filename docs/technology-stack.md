# Technology Stack

This project uses a concrete, implementation-ready stack.

## Runtime

- Node.js 24 LTS.
- TypeScript 5.7.
- Yarn Classic with `yarn.lock` v1.

## HTTP Framework

- NestJS 11.
- `@nestjs/platform-express` as the HTTP adapter.
- Thin controllers with business logic delegated to domain services.

## Persistence

- SQLite database stored on disk.
- TypeORM 0.3 as the ORM.
- `@nestjs/typeorm` for NestJS integration.
- `better-sqlite3` as the TypeORM SQLite driver.
- TypeORM migrations stored in the repository.
- TypeORM repositories for persistence operations.
- WAL mode enabled during database initialization.
- Domain services own all event processing decisions.

## Background Processing

- `@nestjs/schedule` for the polling worker.
- One active worker for one SQLite database file.
- Jobs stored in `event_processing_jobs`.
- Processing order based on `raw_incoming_events.id ASC`.

## Validation

- `zod` for event-level validation inside the processing engine.
- NestJS pipes only for request container validation, such as checking that
  `POST /events` receives an array.

## Configuration

- `@nestjs/config` for environment variables.
- Required configuration is validated during application startup.

## Testing

- Jest for unit tests.
- `@nestjs/testing` and Supertest for integration and API tests.
- `autocannon` for performance baselines.

## Authentication

- NestJS guard.
- API key from `X-API-Key`.
- Timing-safe comparison through Node.js `crypto`.
