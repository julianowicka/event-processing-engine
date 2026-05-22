# Authentication

Authentication is intentionally planned as a final implementation step after the
event engine, persistence, and tests are stable.

## Approach

Use a NestJS guard with API key authentication for machine-to-machine access.

## Implementation Plan

- Add an `AuthModule`.
- Add an `ApiKeyGuard`.
- Require `X-API-Key` on protected endpoints.
- Store the expected key in an environment variable.
- Validate that the key exists during application startup.
- Compare keys using a timing-safe comparison.
- Return `401 Unauthorized` when the key is missing or invalid.
- Keep `GET /health` unprotected for monitoring and deployment checks.

## Protected Endpoints

- `POST /events`
- `GET /orders/:id`
- `GET /stats`

## Public Endpoints

- `GET /health`

## Configuration

- `API_KEY`: required secret used by clients.
- `AUTH_ENABLED`: optional flag for local development and tests.

Tests should override configuration through the NestJS testing module instead of
hardcoding secrets.
