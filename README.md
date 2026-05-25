# Event Processing Engine

NestJS + TypeScript application for processing asynchronous order events. The
engine stores raw deliveries, processes them in the background, maintains the
current order state, records history and audit decisions, and exposes processing
statistics.

## Architecture Decisions

- Runtime: Node.js 24.11+.
- Framework: NestJS 11.
- Persistence: TypeORM 1 with `better-sqlite3` and a local SQLite database file.
- Default database path: `data/app.sqlite`.
- Database override: `SQLITE_DB_PATH=/absolute/path/app.sqlite`.
- Schema: versioned TypeORM migrations; schema synchronization is disabled.
- `POST /events` is ingestion-only and returns queued results.
- `raw_incoming_events` is an insert-only raw delivery log.
- `event_processing_jobs` is the technical queue/status table.
- `EventWorkerService` processes pending and deferred jobs.
- Deduplication is enforced through `processed_event_keys.event_id`.
- Raw deliveries, processing jobs, order state, history, audit decisions, stats,
  and DLQ records are stored in SQLite tables.

Detailed design documents live in [docs](./docs/README.md).

## Run With Docker Compose

```bash
docker compose up --build
```

The default Compose file is configured for local development. API source files
are mounted into the container and Nest runs in watch mode, so changes under
`src` rebuild and restart automatically. Frontend files are also mounted into
nginx, so refresh the browser after changing `frontend/index.html`,
`frontend/styles.css`, or `frontend/app.js`.

Use `--build` again only after changing Dockerfiles, package dependencies, or
other image-level setup.

Services:

- API: `http://localhost:3100/api`
- Frontend: `http://localhost:8080`
- SQLite file in the `database-data` Docker volume at `/data/app.sqlite`

Verbose worker tracing can be enabled for debugging:

```bash
EVENT_WORKER_VERBOSE_LOGS=true docker compose up --build
```

Then inspect the processing flow with:

```bash
docker compose logs -f api
```

## Production Deployment

Production is deployed to an OVH VPS through GitHub Actions and GitHub
Container Registry. The deployment runs the API and frontend as separate
containers behind the existing Caddy reverse proxy, with SQLite retained in a
dedicated Docker volume.

See [deploy/README.md](./deploy/README.md) for VPS, DNS, GHCR, and deployment
setup instructions.

## Local Run

This project uses TypeORM 1 and its `better-sqlite3` SQLite driver, so use
Node.js 24.11 or newer.

```bash
yarn install
yarn start:dev
```

By default the API writes to `data/app.sqlite`. Override it with:

```bash
SQLITE_DB_PATH=/absolute/path/app.sqlite yarn start:dev
```

Migrations run automatically when the application connects. They can also be
inspected or run explicitly:

```bash
yarn migration:show
yarn migration:run
yarn migration:revert
```

The initial TypeORM migration treats any database from the previous raw-SQL
implementation as disposable and recreates the application tables.

## Business API

- `POST /api/events`: accepts a batch of order events and queues them.
- `GET /api/events/:eventId`: diagnostic event inspector with raw deliveries,
  decisions, and matching history rows.
- `GET /api/orders/:id`: returns current order state, history, rejected events,
  pending jobs, and audit log.
- `GET /api/stats`: returns valid, rejected, duplicate, timing, pending, and DLQ
  counters.
- `GET /api/health`: returns service status and configured database path.

Example event batch:

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

## Test And Build

```bash
yarn test
yarn test:e2e
yarn build
```
