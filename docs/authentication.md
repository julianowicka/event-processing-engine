# Authentication

Authentication is intentionally out of scope for the recruitment-task MVP.

The task requires the business API and a short README. Adding mandatory
authentication would make evaluator calls harder because every sample request
would need an API key.

## Current Behavior

- `POST /events` is public.
- `GET /orders/:id` is public.
- `GET /stats` is public.
- `GET /health` is public.

## Future Option

If machine-to-machine protection is needed later:

- Add an `AuthModule`.
- Add an `ApiKeyGuard`.
- Require `X-API-Key` on business endpoints.
- Store the expected key in `API_KEY`.
- Keep `GET /health` public.

Authentication should be disabled by default for local recruitment evaluation.
