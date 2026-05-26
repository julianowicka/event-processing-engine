<div align="center">

# Event Processing Engine

**Reliable order state from unreliable asynchronous events.**

[Live Demo](https://event-processing-engine.julianowicka.dev/) |
[Architecture Docs](./docs/README.md) | [Deployment](./deploy/README.md)

<img alt="Node.js 24.11+" src="https://img.shields.io/badge/Node.js-24.11+-339933?style=flat-square&logo=nodedotjs&logoColor=white">
<img alt="NestJS 11" src="https://img.shields.io/badge/NestJS-11-E0234E?style=flat-square&logo=nestjs&logoColor=white">
<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white">
<img alt="SQLite" src="https://img.shields.io/badge/SQLite-local_file-003B57?style=flat-square&logo=sqlite&logoColor=white">
<img alt="Docker" src="https://img.shields.io/badge/Docker-compose-2496ED?style=flat-square&logo=docker&logoColor=white">
<img alt="Jest" src="https://img.shields.io/badge/Jest-tested-C21325?style=flat-square&logo=jest&logoColor=white">

</div>

## Processing Architecture

```mermaid
flowchart TB
  client["External integrations"] -->|"POST /api/events"| api["NestJS API"]
  api -->|"durable append"| inbox[("raw_incoming_events<br/>immutable input + queue state")]
  api -->|"queued result"| accepted["Async acceptance"]

  inbox -->|"PENDING / RETRY"| scheduler["EventProcessingScheduler"]

  subgraph worker["Worker pipeline"]
    direction LR
    scheduler --> validate["Validate"]
    validate --> dedupe["Deduplicate"]
    dedupe --> transition["Apply state rules"]
    transition --> finalize["Finalize decision"]
  end

  dedupe --> keys[("processed_event_keys<br/>idempotency")]
  transition --> orders[("orders<br/>current read model")]
  transition --> versions[("order_field_versions<br/>field freshness")]
  finalize --> decisions[("event_decisions<br/>audit trail")]
  finalize --> stats[("stats<br/>aggregate metrics")]
  finalize --> inbox

  orders --> ordersApi["GET /api/orders/:id"]
  decisions --> ordersApi
  stats --> statsApi["GET /api/stats"]

  classDef ingress fill:#eef6ff,stroke:#2563eb,color:#0f172a;
  classDef workerNode fill:#fff7ed,stroke:#c2410c,color:#0f172a;
  classDef store fill:#f8fafc,stroke:#64748b,color:#0f172a;
  classDef read fill:#ecfdf5,stroke:#047857,color:#0f172a;

  class client,api,accepted ingress;
  class scheduler,validate,dedupe,transition,finalize workerNode;
  class inbox,keys,orders,versions,decisions,stats store;
  class ordersApi,statsApi read;
```

The HTTP request is intentionally small: it durably accepts input and returns
queued results. The worker later performs validation, deduplication, business
rules, retries, state updates, audit writes, and statistics updates.

## State Pattern Core

Order transition logic is implemented with the
[State pattern](https://refactoring.guru/design-patterns/state). Instead of a
large conditional tree for every possible order status, the worker delegates
event handling to a status-specific handler selected by `OrderStatus`.

| State Pattern role | Implementation                                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context            | Event processing flow resolves the current order status before applying a delivery.                                                                                                       |
| State interface    | `OrderEventHandler` declares handlers for order lifecycle events.                                                                                                                         |
| Concrete states    | `OrderCreatedEventHandler`, `OrderPaidEventHandler`, `OrderCancelledEventHandler`, `OrderPartiallyRefundedEventHandler`, `OrderRefundedEventHandler`, and `NonExistentOrderEventHandler`. |
| State selection    | `OrderEventHandlerFactory` discovers `@HandlesOrderStatus(...)` providers and returns the handler for the current status.                                                                 |

This keeps state-specific rules close to the state that owns them: for example,
`PAYMENT_CAPTURED` can be valid for `CREATED`, rejected for `PAID`, and
impossible for `CANCELLED`, without burying those cases in one sprawling
dispatcher.

## Why This Exists

External integrations rarely send clean event streams. Deliveries can be
duplicated, delayed, malformed, stale, or only partially describe the latest
state. This engine accepts those events asynchronously and turns them into a
consistent order read model with an explicit audit trail for every final
decision.

| Area        | Implementation                                                                      |
| ----------- | ----------------------------------------------------------------------------------- |
| Ingestion   | `POST /api/events` stores every raw delivery and returns queued results.            |
| Processing  | A background scheduler processes `PENDING` and `RETRY` rows in deterministic order. |
| Idempotency | `processed_event_keys.event_id` claims the first valid external event id.           |
| Ordering    | `eventTimestamp ASC NULLS LAST`, then raw delivery `id ASC`.                        |
| Merging     | `order_field_versions` applies newer fields without erasing missing ones.           |
| Audit       | `event_decisions` records one final outcome per delivery.                           |
| Storage     | SQLite file with TypeORM migrations and schema sync disabled.                       |

## Event Lifecycle

```mermaid
sequenceDiagram
  autonumber
  participant Client as API client
  participant API as NestJS API
  participant Inbox as raw_incoming_events
  participant Worker as Background worker
  participant State as orders / field versions
  participant Audit as event_decisions / stats

  Client->>API: POST /api/events
  API->>Inbox: Insert raw JSON + projections
  API-->>Client: Queued response

  loop scheduler tick
    Worker->>Inbox: Select available PENDING / RETRY rows
    Worker->>Worker: Validate shape and event type
    Worker->>Audit: Write DUPLICATE / REJECTED when final
    Worker->>State: Apply allowed state and field changes
    Worker->>Audit: Record ACCEPTED / PARTIALLY_APPLIED / FAILED
    Worker->>Inbox: Mark delivery DONE or schedule RETRY
  end
```

## Order State Machine

```mermaid
stateDiagram-v2
  [*] --> CREATED: ORDER_CREATED
  CREATED --> PAID: PAYMENT_CAPTURED
  CREATED --> CANCELLED: ORDER_CANCELLED
  PAID --> PARTIALLY_REFUNDED: REFUND_ISSUED (partial)
  PAID --> REFUNDED: REFUND_ISSUED (full)
  PARTIALLY_REFUNDED --> PARTIALLY_REFUNDED: REFUND_ISSUED (partial)
  PARTIALLY_REFUNDED --> REFUNDED: REFUND_ISSUED (remaining)

  CREATED --> CREATED: ORDER_UPDATED fields
  PAID --> PAID: ORDER_UPDATED fields
  CANCELLED --> CANCELLED: ORDER_UPDATED fields
  PARTIALLY_REFUNDED --> PARTIALLY_REFUNDED: ORDER_UPDATED fields
  REFUNDED --> REFUNDED: ORDER_UPDATED fields
```

Lifecycle status is owned by lifecycle events. `ORDER_UPDATED.payload.status`
is accepted as input, but it is not authoritative; payment, cancellation, and
refund transitions must come from their domain event types.

## Decision Outcomes

| Decision            | Meaning                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `ACCEPTED`          | The event changed order state.                                          |
| `PARTIALLY_APPLIED` | Newer fields were applied while stale or forbidden fields were skipped. |
| `REJECTED`          | The event was invalid, obsolete, or violated a business rule.           |
| `DUPLICATE`         | A valid `eventId` was already claimed by an earlier delivery.           |
| `FAILED`            | An unexpected technical failure exhausted the retry limit.              |

Missing-order events are retried on a bounded delay before they become a final
`ORDER_NOT_READY` rejection. Retry attempts are lifecycle metadata, not audit
decisions.

## Persistence Model

```mermaid
erDiagram
  RAW_INCOMING_EVENTS ||--o| PROCESSED_EVENT_KEYS : "first valid eventId"
  RAW_INCOMING_EVENTS ||--o| EVENT_DECISIONS : "final decision"
  ORDERS ||--o{ ORDER_FIELD_VERSIONS : "field freshness"

  RAW_INCOMING_EVENTS {
    integer id PK
    text event_id
    text order_id
    text type
    integer event_timestamp
    text processing_status
    integer attempts
  }

  PROCESSED_EVENT_KEYS {
    text event_id PK
    integer first_raw_incoming_event_id FK
  }

  ORDERS {
    text order_id PK
    text status
    integer amount_minor
    text currency
    integer paid_amount_minor
    integer refunded_amount_minor
  }

  ORDER_FIELD_VERSIONS {
    text order_id PK
    text field_name PK
    integer last_event_timestamp
    text last_event_id
  }

  EVENT_DECISIONS {
    integer id PK
    integer raw_incoming_event_id FK
    text decision
    text reason_code
    text changed_fields_json
    integer processing_time_ms
  }

  STATS {
    integer id PK
    integer valid_events_count
    integer rejected_events_count
    integer duplicate_events_count
    integer processed_events_count
  }
```

The full schema and trade-offs are documented in
[docs/database.md](./docs/database.md). The worker flow is documented in
[docs/processing-flow.md](./docs/processing-flow.md).

## Quick Start

```bash
docker compose up --build
```

| Service     | URL / path                                        |
| ----------- | ------------------------------------------------- |
| API         | `http://localhost:3100/api`                       |
| Frontend    | `http://localhost:8080`                           |
| SQLite file | `./data/app.sqlite` mounted as `/data/app.sqlite` |

Verbose worker logs:

```bash
EVENT_WORKER_VERBOSE_LOGS=true docker compose up --build
```

Follow processing:

```bash
docker compose logs -f api
```

## API

| Method | Path              | Purpose                                                                    |
| ------ | ----------------- | -------------------------------------------------------------------------- |
| `POST` | `/api/events`     | Store a batch of events for async processing.                              |
| `GET`  | `/api/orders/:id` | Read current state, history, rejected events, pending jobs, and audit log. |
| `GET`  | `/api/stats`      | Read valid, rejected, duplicate, and average processing time metrics.      |
| `GET`  | `/api/health`     | Check service status and configured database path.                         |

Example batch:

```bash
curl -X POST http://localhost:3100/api/events \
  -H "Content-Type: application/json" \
  -d '[
    {
      "eventId": "evt-1001",
      "orderId": "ord-501",
      "type": "ORDER_CREATED",
      "timestamp": 1710000900,
      "payload": {
        "amount": 199.99,
        "currency": "PLN"
      }
    }
  ]'
```

Queued response:

```json
{
  "mode": "ASYNC_WORKER",
  "results": [
    {
      "incomingEventId": 1,
      "eventId": "evt-1001",
      "orderId": "ord-501",
      "type": "ORDER_CREATED",
      "status": "QUEUED",
      "reasonCode": null,
      "reasonMessage": "Queued for asynchronous processing",
      "processingTimeMs": 0
    }
  ],
  "summary": {
    "queued": 1
  }
}
```

## Local Development

Requirements:

- Node.js `24.11+`
- Yarn

```bash
yarn install
yarn start:dev
```

By default the API writes to `data/app.sqlite`. Override the database file with:

```bash
SQLITE_DB_PATH=/absolute/path/app.sqlite yarn start:dev
```

Migrations run automatically on application startup. They can also be inspected
or run explicitly:

```bash
yarn migration:show
yarn migration:run
yarn migration:revert
```

## Test And Build

```bash
yarn test
yarn test:e2e
yarn test:e2e --runTestsByPath ./test/__tests__/recruitment-requirements.e2e-spec.ts
yarn build
```

The recruitment acceptance e2e test above runs locally against an isolated
temporary SQLite database and checks the task requirements end to end:
deduplication, out-of-order events, partial updates, invalid events, state
transitions, audit log, order history, and stats.

Deployed smoke/load tests are opt-in because they write synthetic `smoke-*`,
`hostile-*`, `dupe-*`, and `load-*` events to the target database:

```bash
E2E_BASE_URL=https://event-processing-engine.julianowicka.dev yarn test:e2e:deployed

E2E_BASE_URL=https://event-processing-engine.julianowicka.dev \
E2E_RUN_LOAD=true \
E2E_LOAD_REQUESTS=1000 \
E2E_LOAD_CONCURRENCY=25 \
yarn test:e2e:deployed
```

`E2E_BASE_URL` selects the deployed API origin, `E2E_RUN_LOAD=true` enables the
load probe, and `E2E_LOAD_REQUESTS` / `E2E_LOAD_CONCURRENCY` control its volume.

## Project Map

| Path                           | Notes                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------- |
| [src/events](./src/events)     | Event ingestion, scheduling, validation, decisions, and business processing. |
| [src/orders](./src/orders)     | Order read model API and response composition.                               |
| [src/database](./src/database) | TypeORM entities, repositories, migrations, and transaction boundary.        |
| [src/stats](./src/stats)       | Processing statistics endpoint and service.                                  |
| [frontend](./frontend)         | Small nginx-served inspector UI for the API.                                 |
| [docs](./docs/README.md)       | Deep-dive architecture notes and edge-case decisions.                        |
| [deploy](./deploy/README.md)   | Production VPS, GHCR, Caddy, and Docker Compose deployment notes.            |

## Design Docs

- [API Contract](./docs/api-contract.md)
- [Processing Flow](./docs/processing-flow.md)
- [Database](./docs/database.md)
- [State Machine](./docs/state-machine.md)
- [Merging Strategies](./docs/merging-strategies.md)
- [Error Handling](./docs/error-handling.md)
- [Testing Scenarios](./docs/testing-scenarios.md)

## Production Deployment

Production runs the API and frontend as separate containers behind the existing
Caddy reverse proxy, with SQLite stored in a dedicated Docker volume. See
[deploy/README.md](./deploy/README.md) for VPS, DNS, GHCR, and deployment
setup.
