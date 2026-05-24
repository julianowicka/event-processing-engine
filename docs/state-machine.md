# State Machine

The order status state machine is explicit and small. It prevents impossible
business transitions such as `CANCELLED -> PAID`.

Implementation uses an explicit dispatcher with one handler strategy for each
supported event type. Shared transition and merge policy services keep the
individual handlers focused on the rule for their event.

## States

- `CREATED`: order exists and no payment has been captured.
- `PAID`: one payment has been captured.
- `CANCELLED`: order was cancelled before payment.
- `PARTIALLY_REFUNDED`: some captured payment has been refunded.
- `REFUNDED`: all captured payment has been refunded.

`NEW` is only an internal conceptual state before `ORDER_CREATED` is accepted.

## Event Mapping

- `ORDER_CREATED`: `NEW -> CREATED`.
- `ORDER_UPDATED`: updates set-like fields and may request a direct
  `payload.status` transition.
- `PAYMENT_CAPTURED`: `CREATED -> PAID`.
- `ORDER_CANCELLED`: `CREATED -> CANCELLED`.
- `REFUND_ISSUED`: `PAID -> PARTIALLY_REFUNDED | REFUNDED`.
- `REFUND_ISSUED`: `PARTIALLY_REFUNDED -> PARTIALLY_REFUNDED | REFUNDED`.

Supporting `payload.status` on `ORDER_UPDATED` keeps the engine compatible with
the example event shape from the task while still using explicit payment/refund
events when those are available.

## Forbidden Examples

- `CANCELLED -> PAID`
- `REFUNDED -> PAID`
- `NEW -> PAID`
- `CANCELLED -> REFUNDED`
- direct `ORDER_UPDATED` to `PARTIALLY_REFUNDED` without a refund amount

## Financial Notes

`PAYMENT_CAPTURED` captures a positive amount. If no amount is provided, the
current order amount is used.

`REFUND_ISSUED` requires a positive amount or `refundAmount`. The refund amount
is cumulative and cannot exceed the captured payment amount.
