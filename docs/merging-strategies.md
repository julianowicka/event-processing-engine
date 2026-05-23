# Merging Strategies

Events can arrive late, out of order, or with partial payloads. The engine uses
two different strategies depending on the meaning of the field.

## Set-Like Fields

These fields represent the latest known value:

- `amountMinor`
- `currency`
- `status` when status is requested directly by `ORDER_UPDATED`

A set-like field is applied only when the event timestamp is strictly greater
than the timestamp stored for that field.

Same timestamp tie-breaker:

- The first accepted event for that field wins.
- A later event with the same timestamp is skipped for that field.
- If no fields remain applicable, the event is rejected as obsolete.

This fixes the earlier ambiguity between `>=` and "first accepted wins".

## Partial Application

When an event contains several fields:

- newer fields are applied,
- obsolete fields are skipped,
- the audit decision is `PARTIALLY_APPLIED` when both happen.

Missing payload fields never erase existing state.

## Financial Fact Fields

Payment and refund events are facts, not simple overwrites.

- `PAYMENT_CAPTURED` captures one payment and sets `paidAmountMinor`.
- `REFUND_ISSUED` adds a refund delta to `refundedAmountMinor`.

Refund events therefore use cumulative arithmetic instead of "latest timestamp
wins". Deduplication by `eventId` prevents the same financial fact from being
applied twice.

## Status Changes

Status changes must satisfy the state machine. A direct `payload.status` update
is also subject to the set-like timestamp rule for `status`.

Derived status changes from payment/refund events are handled by the business
rule for that event type:

- payment moves `CREATED -> PAID`,
- refunds move `PAID -> PARTIALLY_REFUNDED | REFUNDED`,
- refunds can continue from `PARTIALLY_REFUNDED`.

## Money Fields

The public API accepts decimal money values, for example `199.99`. The engine
stores them as integer minor units, for example `19999`.

Accepted money fields must be non-negative decimals with at most two fractional
digits. Refund and payment event amounts must be positive.
