# Architecture Docs

This folder contains the detailed design notes for the Event Processing Engine.
The root [README](../README.md) is the high-level product and setup overview;
these documents explain the implementation choices, edge cases, and trade-offs.

## Start Here

- [API Contract](./api-contract.md): implemented endpoints, request/response
  shapes, and eventual-consistency notes.
- [Processing Flow](./processing-flow.md): ingestion, durable queue processing,
  retries, and final decision writes.
- [Database](./database.md): SQLite schema, table responsibilities, indexes, and
  persistence trade-offs.

## Domain Behavior

- [State Machine](./state-machine.md): supported order states and transition
  rules.
- [Merging Strategies](./merging-strategies.md): stale event handling and
  field-level partial updates.
- [Edge Cases](./edge-cases.md): invalid input, duplicates, missing orders, and
  conflict cases.
- [Error Handling](./error-handling.md): validation decisions, technical retry
  behavior, and exhausted failures.

## Engineering Notes

- [Multi-threading](./multi-threading.md): current single-worker assumption and
  what would change for multi-worker processing.
- [Technology Stack](./technology-stack.md): runtime, framework, persistence,
  validation, and testing choices.
- [Quality Plan](./quality-plan.md): test focus areas and risk coverage.
- [Testing Scenarios](./testing-scenarios.md): behavior scenarios covered by the
  test suite.
- [Implementation Roadmap](./implementation-roadmap.md): implementation plan and
  sequencing.
- [Authentication](./authentication.md): current authentication scope and future
  machine-to-machine option.
