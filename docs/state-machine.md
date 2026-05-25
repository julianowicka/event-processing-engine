# State Machine

The order status state machine is explicit and small. It prevents impossible
business transitions such as `CANCELLED -> PAID`.

The implementation uses an explicit dispatcher with one handler strategy for
each current order status. Shared application services keep the individual
handlers focused on which events are allowed from that status.

## States

- `CREATED`: order exists and no payment has been captured.
- `PAID`: one payment has been captured.
- `CANCELLED`: order was cancelled before payment.
- `PARTIALLY_REFUNDED`: some captured payment has been refunded.
- `REFUNDED`: all captured payment has been refunded.

`NEW` is only an internal conceptual state before `ORDER_CREATED` is accepted.

## Successful Event Mapping

- `ORDER_CREATED`: `NEW -> CREATED`.
- `ORDER_UPDATED`: updates descriptive set-like fields, currently `amount` and
  `currency`; it does not change lifecycle status and can run against existing
  orders in any persisted status.
- `PAYMENT_CAPTURED`: `CREATED -> PAID`.
- `ORDER_CANCELLED`: `CREATED -> CANCELLED`.
- `REFUND_ISSUED`: `PAID -> PARTIALLY_REFUNDED | REFUNDED`.
- `REFUND_ISSUED`: `PARTIALLY_REFUNDED -> PARTIALLY_REFUNDED | REFUNDED`.

Events other than `ORDER_CREATED` for a missing order are retried before final
`ORDER_NOT_READY` rejection. `ORDER_CREATED` for an existing order is rejected
with `ORDER_ALREADY_EXISTS`.

Events that are recognized by the engine but not allowed from the current
state still get explicit audit decisions. For example,
`PAYMENT_CAPTURED` succeeds only from `CREATED`; if another payment capture
arrives after the order is already `PAID`, `PARTIALLY_REFUNDED`, or `REFUNDED`,
the event is rejected with `PAYMENT_ALREADY_CAPTURED`.

The assignment uses an `ORDER_UPDATED` payload containing `status: "PAID"` as
an input example. In this design that field is accepted as input but is not
authoritative for a lifecycle transition. A payment must be represented by
`PAYMENT_CAPTURED`, because only that event can consistently set both `PAID`
and `paidAmountMinor`. If the same update contains applicable descriptive
fields, those fields can be applied and the ignored status is included in a
`PARTIALLY_APPLIED` audit decision.

## Forbidden Examples

- `CANCELLED -> PAID`
- `NEW -> PAID`
- `CANCELLED -> REFUNDED`
- direct `ORDER_UPDATED` to any different lifecycle status
- repeated `PAYMENT_CAPTURED` after a payment was already captured

## Financial Notes

`PAYMENT_CAPTURED` requires a positive `amount` and sets
`paidAmountMinor`. A second payment capture is rejected with
`PAYMENT_ALREADY_CAPTURED`.

`REFUND_ISSUED` requires a positive `refundAmount` or `amount`. The refund
amount is cumulative and cannot exceed the remaining captured payment amount.
