# State Machine

Order status transitions will use the State pattern. Each state object exposes
allowed actions and returns the next state or a forbidden transition decision.

## States

- `NEW`: internal initial state before creation is accepted.
- `CREATED`: order exists but payment has not been captured.
- `PAID`: payment has been captured.
- `CANCELLED`: order was cancelled before final settlement.
- `PARTIALLY_REFUNDED`: some captured payment was refunded.
- `REFUNDED`: all captured payment was refunded.

## Event Mapping

- `ORDER_CREATED`: `NEW -> CREATED`.
- `ORDER_UPDATED`: may update fields without changing status.
- `PAYMENT_CAPTURED`: `CREATED -> PAID`.
- `ORDER_CANCELLED`: `CREATED -> CANCELLED`.
- `REFUND_ISSUED`: `PAID -> PARTIALLY_REFUNDED | REFUNDED`.
- `REFUND_ISSUED`: `PARTIALLY_REFUNDED -> PARTIALLY_REFUNDED | REFUNDED`.

## Forbidden Examples

- `CANCELLED -> PAID`.
- `REFUNDED -> PAID`.
- `NEW -> PAID`.
- `CANCELLED -> REFUNDED`.

## Business Notes

Cancellation is allowed before payment capture. Refunds are allowed only after
payment capture. Partial refunds depend on cumulative refunded amount in minor
units.
