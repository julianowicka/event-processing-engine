# Testing Scenarios

Tests focus on the business rules that matter for the recruitment task.

## Implemented Unit Coverage

- Worker-style processing of queued deliveries.
- Event arrives before `ORDER_CREATED` and is retried after creation.
- Duplicate `eventId` handling.
- Field-level partial merge for late updates.
- Forbidden transition such as `CANCELLED -> PAID`.
- Technical worker failure moves to DLQ after retry limit.

## Additional Useful Scenarios

- Malformed event item is stored and rejected.
- Unknown event type is rejected.
- Same timestamp conflict keeps the first accepted field value.
- Partial refund then full refund.
- Refund exceeding captured payment is rejected.
- Direct `ORDER_UPDATED` status transition follows the state machine.
- `GET /orders/:id` returns current state, history, rejected events, pending
  events, and audit log.
- `GET /stats` returns required counters.

## Quality Gate

Before submitting:

- Build passes.
- Jest tests pass.
- README explains assumptions and how to run the app.
- Manual smoke test covers `POST /events`, worker processing,
  `GET /orders/:id`, and `GET /stats`.

Performance baselines and broad integration tests are useful future work, but
they are not required for the MVP because tests are optional bonus points in the
task.
