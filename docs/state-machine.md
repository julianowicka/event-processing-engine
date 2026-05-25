# State Machine

The order status state machine is explicit and small. It prevents impossible
business transitions such as `CANCELLED -> PAID`.

The target design uses an explicit dispatcher with one handler strategy for each
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
- `ORDER_UPDATED`: updates descriptive set-like fields, currently `amount` and
  `currency`; it does not change lifecycle status.
- `PAYMENT_CAPTURED`: `CREATED -> PAID`.
- `ORDER_CANCELLED`: `CREATED -> CANCELLED`.
- `REFUND_ISSUED`: `PAID -> PARTIALLY_REFUNDED | REFUNDED`.
- `REFUND_ISSUED`: `PARTIALLY_REFUNDED -> PARTIALLY_REFUNDED | REFUNDED`.

The assignment uses an `ORDER_UPDATED` payload containing `status: "PAID"` as
an input example. In this design that field is accepted as input but is not
authoritative for a lifecycle transition. A payment must be represented by
`PAYMENT_CAPTURED`, because only that event can consistently set both `PAID`
and `paidAmountMinor`. If the same update contains applicable descriptive
fields, those fields can be applied and the ignored status is included in a
`PARTIALLY_APPLIED` audit decision.

## Forbidden Examples

- `CANCELLED -> PAID`
- `REFUNDED -> PAID`
- `NEW -> PAID`
- `CANCELLED -> REFUNDED`
- direct `ORDER_UPDATED` to any different lifecycle status

## Financial Notes

`PAYMENT_CAPTURED` captures a positive amount. If no amount is provided, the
current order amount is used.

`REFUND_ISSUED` requires a positive amount or `refundAmount`. The refund amount
is cumulative and cannot exceed the captured payment amount.
