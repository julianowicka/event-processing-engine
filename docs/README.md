# Event Processing Engine Architecture

This folder captures the implementation plan for the order event processing engine.
The goal is to keep the system explicit, reliable, and production-minded without
introducing workflow engines or infrastructure that hides domain decisions.

## Scope

This is designed as a recruitment-task sized service, not a full distributed
event platform. SQLite and one worker are intentional choices for simple local
execution, deterministic tests, and easy review.

In production, the same domain rules could sit behind a broker, schema registry,
dead-letter queue, tracing, and replay tooling.

## Core Decisions

- Runtime: Node.js 24 LTS with TypeScript.
- Package manager: Yarn Classic, matching the existing `yarn.lock` v1 file.
- Framework: NestJS 11 with the Express adapter.
- Storage: SQLite on disk.
- Database access: TypeORM with the `better-sqlite3` driver.
- Background processing: `@nestjs/schedule` worker backed by SQLite jobs.
- Validation: `zod` schemas inside the event processing layer.
- Ingestion behavior: `POST /events` stores raw deliveries and queues jobs.
- Processing behavior: one worker processes jobs independently in raw delivery order.
- State access: current order state is stored directly for fast reads.
- History access: accepted changes, rejected events, and engine decisions are stored separately.
- Merge strategy: field-level conflict resolution using per-field timestamps.
- State logic: order status transitions use the State pattern.
- Authentication: implemented after the core engine is complete.

## Documents

- [Database](./database.md)
- [Error Handling](./error-handling.md)
- [Multi-threading](./multi-threading.md)
- [Merging Strategies](./merging-strategies.md)
- [Authentication](./authentication.md)
- [Edge Cases](./edge-cases.md)
- [Testing Scenarios](./testing-scenarios.md)
- [Technology Stack](./technology-stack.md)
- [API Contract](./api-contract.md)
- [State Machine](./state-machine.md)
- [Processing Flow](./processing-flow.md)
- [Quality Plan](./quality-plan.md)
- [Implementation Roadmap](./implementation-roadmap.md)
