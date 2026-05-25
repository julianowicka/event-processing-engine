# Testing Scenarios

Tests focus on the business rules that matter for the recruitment task.

## Target Unit Coverage

- Worker-style processing of stored deliveries.
- Raw JSON remains immutable while lifecycle state on `raw_incoming_events`
  moves from pending to final state.
- Event requiring an order before `ORDER_CREATED` is retried and rejected with
  `ORDER_NOT_READY` only after the retry limit.
- Duplicate `eventId` handling.
- Field-level partial merge for late updates.
- Forbidden transition such as `CANCELLED -> PAID`.
- `ORDER_UPDATED` can partially apply amount or currency while rejecting a
  supplied lifecycle status.
- Technical worker failure creates a final `FAILED` decision after retry limit.

## Additional Useful Scenarios

- Malformed event item is stored and rejected.
- Unknown event type is rejected.
- Same timestamp conflict keeps the first accepted field value.
- Partial refund then full refund.
- Refund exceeding captured payment is rejected.
- `PAYMENT_CAPTURED` creates a consistent `PAID` state and captured amount.
- Repeated `PAYMENT_CAPTURED` is rejected with `PAYMENT_ALREADY_CAPTURED`.
- `GET /api/orders/:id` returns current state, history, rejected events, and
  audit log after eventual processing completes.
- `GET /api/stats` returns required counters.

## Quality Gate

Before submitting:

- Build passes.
- Jest tests pass.
- README explains assumptions and how to run the app.
- Manual smoke test covers `POST /api/events`, worker processing,
  `GET /api/orders/:id`, and `GET /api/stats`.

Performance baselines and broad integration tests are useful future work, but
they are not required for the MVP because tests are optional bonus points in the
task.
