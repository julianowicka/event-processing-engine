# Implementation Roadmap

The implementation will prioritize a working engine before secondary concerns.

## Phase 1: Storage Foundation

- Add `typeorm`, `@nestjs/typeorm`, `better-sqlite3`, `@types/better-sqlite3`, and `@nestjs/schedule`.
- Configure the TypeORM DataSource.
- Create TypeORM entities.
- Create TypeORM migrations for tables and indexes.
- Add repository services around TypeORM repositories.
- Add append-only ingestion tables and processing job tables.

## Phase 2: Domain Engine

- Add `zod` for event-level validation.
- Define event, order, state, decision, and reason enums.
- Implement validation.
- Implement State pattern.
- Implement field-level merge.
- Implement job claiming and per-job transactions.
- Implement deduplication through `processed_event_keys`.

## Phase 3: API

- Implement `POST /events`.
- Implement asynchronous event worker.
- Implement `GET /orders/:id`.
- Implement `GET /stats`.
- Implement `GET /health`.
- Add clear response DTOs.

## Phase 4: Tests

- Add unit tests for validation, state transitions, and merge logic.
- Add integration tests for API and SQLite.
- Add `autocannon` performance baseline tests.

## Phase 5: Authentication

- Add API key guard.
- Protect all business endpoints.
- Document configuration.

## Phase 6: README

- Replace Nest starter README.
- Document assumptions.
- Add setup, run, test, and API examples.
